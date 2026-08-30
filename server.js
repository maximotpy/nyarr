const fs = require('fs');
const path = require('path');
const express = require('express');
const db = require('./src/db');
const scheduler = require('./src/scheduler');
const crypto = require('crypto');
const { verifyPassword, hashPassword, generateSalt, timingSafeStringEqual } = require('./src/auth');

const app = express();
// Inside a pkg executable, static assets live in the bundled snapshot;
// when running from source, they're the normal public/ folder.
const PUBLIC_DIR = process.pkg
  ? path.join(__dirname, 'public')
  : path.join(__dirname, 'public');

app.use(express.json({ limit: '10mb' })); // generous limit: restore uploads the whole db.json

// ---- Session-cookie login (web UI) ----
// Browsers get a proper login page instead of the native Basic-auth popup.
// API clients can still use Basic auth or the X-Api-Key header.
const SESSION_COOKIE = 'nyarr_session';
const REMEMBER_COOKIE = 'nyarr_remember';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;        // 12h
const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days

// Secret used to sign session tokens; regenerated on restart (sessions
// are ephemeral anyway) unless persisted in general settings.
function getSessionSecret() {
  const g = db.data.general;
  if (!g.sessionSecret) {
    g.sessionSecret = crypto.randomBytes(32).toString('hex');
    db.persist();
  }
  return g.sessionSecret;
}

function sign(value) {
  return crypto.createHmac('sha256', getSessionSecret()).update(value).digest('hex');
}

function makeToken(expiresAt) {
  const payload = String(expiresAt);
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot === -1) return false;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = sign(payload);
  if (mac.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;
  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && Date.now() < expiresAt;
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function checkCredentials(req) {
  const g = db.data.general;
  if (g.authMethod !== 'basic') return true;

  // 1) Session cookie (set by the login page)
  const cookies = parseCookies(req);
  if (cookies[SESSION_COOKIE] && verifyToken(cookies[SESSION_COOKIE])) return true;

  // 2) Classic Basic auth header (API clients, curl, etc.)
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    let decoded = '';
    try {
      decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    } catch { /* fall through to 401 */ }
    const sep = decoded.indexOf(':');
    const user = sep === -1 ? decoded : decoded.slice(0, sep);
    const pass = sep === -1 ? '' : decoded.slice(sep + 1);
    if (
      timingSafeStringEqual(user, g.username) &&
      verifyPassword(pass, g.passwordSalt, g.passwordHash)
    ) {
      return true;
    }
  }
  return false;
}

function wantsHtml(req) {
  // Browser navigations accept HTML; API calls (fetch/XHR) usually don't.
  const accept = req.headers.accept || '';
  return accept.includes('text/html');
}

// Assets needed by the login/setup pages themselves. These must be reachable
// WITHOUT a session, otherwise the logo/css 401 and the browser shows the
// native Basic-auth popup / a broken image on the login screen.
const PUBLIC_AUTH_ASSETS = new Set(['/login', '/setup', '/login.html', '/setup.html', '/login.css', '/logo.png']);

// ---- Auth gate (protects everything, UI + API) ----
// Optional, off by default. Toggle from Settings -> General.
function authMiddleware(req, res, next) {
  const g = db.data.general;

  if (PUBLIC_AUTH_ASSETS.has(req.path)) return next();

  // First-run setup: until an account exists, force everyone to /setup.
  // (authMethod is 'none' by default, so without this the app would be wide open.)
  const needsSetup = g.authMethod !== 'basic' || !g.passwordHash;
  if (needsSetup) {
    if (wantsHtml(req)) return res.redirect('/setup');
    return res.status(503).json({ error: 'Setup required: open the web UI to create an account' });
  }

  if (checkCredentials(req)) return next();

  if (wantsHtml(req)) {
    // Browser: redirect to the login page instead of the Basic popup
    return res.redirect('/login');
  }
  // NOTE: no WWW-Authenticate header here on purpose — sending it makes
  // browsers pop up the native Basic-auth login dialog, which is exactly
  // what the /login page is meant to replace. API clients already know
  // how to send Basic auth or X-Api-Key without the hint.
  res.status(401).send('Authentication required');
}
app.use(authMiddleware);

// ---- First-run setup page + handler ----
app.get('/setup', (req, res) => {
  const g = db.data.general;
  if (g.authMethod === 'basic' && g.passwordHash) return res.redirect('/login');
  res.sendFile(path.join(PUBLIC_DIR, 'setup.html'));
});

app.post('/setup', express.urlencoded({ extended: false }), (req, res) => {
  const g = db.data.general;
  // Only allowed while no account exists yet
  if (g.authMethod === 'basic' && g.passwordHash) return res.redirect('/login');

  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const password2 = typeof req.body?.password2 === 'string' ? req.body.password2 : '';

  if (!username || !password) return res.redirect('/setup?error=1');
  if (password !== password2) return res.redirect('/setup?error=mismatch');

  g.username = username;
  g.authMethod = 'basic';
  g.passwordSalt = generateSalt();
  g.passwordHash = hashPassword(password, g.passwordSalt);
  db.persist();
  db.logActivity(`Account created for "${username}", authentication enabled`);

  // Log the user straight in
  const expiresAt = Date.now() + SESSION_TTL_MS;
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(makeToken(expiresAt))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  );
  res.redirect('/');
});

// ---- Login page + handler ----
app.get('/login', (req, res) => {
  const g = db.data.general;
  if (g.authMethod !== 'basic') return res.redirect('/');
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  const g = db.data.general;
  const { username, password, remember } = req.body || {};
  const ok =
    g.authMethod === 'basic' &&
    typeof username === 'string' &&
    typeof password === 'string' &&
    timingSafeStringEqual(username, g.username) &&
    verifyPassword(password, g.passwordSalt, g.passwordHash);

  if (!ok) {
    return res.redirect('/login?error=1');
  }

  const ttl = remember ? REMEMBER_TTL_MS : SESSION_TTL_MS;
  const expiresAt = Date.now() + ttl;
  const cookieParts = [
    `${SESSION_COOKIE}=${encodeURIComponent(makeToken(expiresAt))}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(ttl / 1000)}`,
  ];
  res.setHeader('Set-Cookie', cookieParts.join('; '));
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.redirect('/login');
});

// ---- Templated index page ----
// Injects the API key server-side so the bundled frontend can call the API
// immediately without a separate bootstrap round-trip. Anyone who can load
// this page has already passed the Basic Auth gate above (if enabled).
app.get('/', (req, res) => {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf-8');
  const bootstrap = `<script>window.NYARR_API_KEY=${JSON.stringify(db.data.general.apiKey)};window.NYARR_INSTANCE_NAME=${JSON.stringify(db.data.general.instanceName)};</script>`;
  res.send(html.replace('<!--NYARR_BOOTSTRAP-->', bootstrap));
});

// File downloads (by post ID -- see src/routes/files.js) live outside the
// API-key gate below since plain <a href> clicks can't attach headers.
// (Already covered by the global basicAuthMiddleware applied above.)
app.use(require('./src/routes/files'));

// ---- API key gate (protects /api/*, same as Sonarr/Radarr's API key) ----
function apiKeyMiddleware(req, res, next) {
  const provided = req.header('X-Api-Key');
  if (provided && timingSafeStringEqual(provided, db.data.general.apiKey)) return next();
  res.status(401).json({ error: 'Missing or invalid API key' });
}

app.use('/api', apiKeyMiddleware);
app.use('/api', require('./src/routes/settings'));
app.use('/api', require('./src/routes/tagsets'));
app.use('/api', require('./src/routes/artists'));
app.use('/api', require('./src/routes/library'));
app.use('/api', require('./src/routes/misc'));
app.use('/api', require('./src/routes/general'));

app.use(express.static(PUBLIC_DIR, { index: false }));

const PORT = process.env.PORT ? Number(process.env.PORT) : db.data.general.port;

app.listen(PORT, () => {
  console.log(`nyarr listening on http://localhost:${PORT}`);
  console.log(`Data directory: ${db.DATA_DIR}`);
  console.log(`Library root:   ${db.data.general.libraryRoot}`);
  scheduler.start();
});
