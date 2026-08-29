const fs = require('fs');
const path = require('path');
const express = require('express');
const db = require('./src/db');
const scheduler = require('./src/scheduler');
const { verifyPassword, timingSafeStringEqual } = require('./src/auth');

const app = express();
const PUBLIC_DIR = path.join(__dirname, 'public');

app.use(express.json({ limit: '10mb' })); // generous limit: restore uploads the whole db.json

// ---- Basic Auth gate (protects everything, UI + API) ----
// Optional — off by default. Toggle from Settings -> General.
function basicAuthMiddleware(req, res, next) {
  const g = db.data.general;
  if (g.authMethod !== 'basic') return next();

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
      return next();
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="nyarr"');
  res.status(401).send('Authentication required');
}
app.use(basicAuthMiddleware);

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
