// Minimal JSON-file datastore. Good enough for a self-hosted prototype;
// swap for SQLite/Postgres later if the library grows large.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Where the app's own state (db.json) lives. Override with NYARR_DATA_DIR
// to relocate the whole app database — e.g. onto a persistent volume in
// Docker, or a different drive. This has to be resolved from the
// environment rather than from a setting *inside* db.json, since the app
// needs to know where that file is before it can read anything from it.
const DATA_DIR = process.env.NYARR_DATA_DIR
  ? path.resolve(process.env.NYARR_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_LIBRARY_ROOT = path.join(__dirname, '..', 'downloads');

const DEFAULTS = {
  general: {
    instanceName: 'nyarr',
    port: 7373,
    // Where downloaded files are written. Editable at runtime via
    // Settings → General — this is the "tell it where to store the data"
    // knob, analogous to a Root Folder in Sonarr/Radarr.
    libraryRoot: DEFAULT_LIBRARY_ROOT,
    authMethod: 'none', // 'none' | 'basic'
    username: '',
    passwordHash: '',
    passwordSalt: '',
    apiKey: crypto.randomBytes(16).toString('hex')
  },
  settings: {
    danbooru: { baseUrl: 'https://danbooru.donmai.us', apiKey: '', username: '' },
    gelbooru: { baseUrl: 'https://gelbooru.com', apiKey: '', userId: '' },
    e621: { baseUrl: 'https://e621.net', apiKey: '', username: '', userAgent: 'nyarr/0.1 (by anonymous)' },
    rule34: { baseUrl: 'https://api.rule34.xxx', apiKey: '', userId: '' },
    safebooru: { baseUrl: 'https://safebooru.org', apiKey: '', userId: '' },
    konachan: { baseUrl: 'https://konachan.com', apiKey: '', username: '' },
    yandere: { baseUrl: 'https://yande.re', apiKey: '', username: '' },
    furbooru: { baseUrl: 'https://furbooru.com', apiKey: '', username: '', userAgent: 'nyarr/0.1 (by anonymous)' },
    sankaku: { baseUrl: 'https://idol.sankakucomplex.com', apiKey: '', userId: '' },
    realbooru: { baseUrl: 'https://realbooru.com', apiKey: '', userId: '' },
    tbib: { baseUrl: 'https://tbib.org', apiKey: '', userId: '' },
    behoimi: { baseUrl: 'https://behoimi.org', apiKey: '', userId: '' }
  },
  tagSets: [],
  posts: [],
  activity: [],
  queue: []
};

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULTS, null, 2));
  }
}

ensureFile();

// Make sure the default library root exists on first run (e.g. a fresh
// clone from git, where downloads/ only contains .gitkeep). Runtime
// changes to libraryRoot are validated/created in routes/general.js, and
// the downloader creates per-post directories on demand — this just
// guarantees the default folder is present at boot.
if (!fs.existsSync(DEFAULT_LIBRARY_ROOT)) {
  fs.mkdirSync(DEFAULT_LIBRARY_ROOT, { recursive: true });
}

let cache = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
// Backfill any top-level keys added since a given db.json was created...
for (const key of Object.keys(DEFAULTS)) {
  if (!(key in cache)) cache[key] = DEFAULTS[key];
}
// ...and any nested keys added to `general` specifically, so upgrading
// an existing install doesn't crash on a missing field.
for (const key of Object.keys(DEFAULTS.general)) {
  if (!(key in cache.general)) cache.general[key] = DEFAULTS.general[key];
}
// Backfill first-level nested keys of other object-shaped defaults (like
// `settings.<indexer>`) as indexers are added over time, so an existing
// db.json gets the new indexer entries with empty credentials.
for (const key of Object.keys(DEFAULTS)) {
  if (!cache[key] || typeof cache[key] !== 'object') continue;
  for (const inner of Object.keys(DEFAULTS[key] || {})) {
    if (!(inner in DEFAULTS[key])) continue;
    if (!(inner in cache[key])) cache[key][inner] = DEFAULTS[key][inner];
  }
}

let writeScheduled = false;
function persist() {
  if (writeScheduled) return;
  writeScheduled = true;
  setImmediate(() => {
    fs.writeFileSync(DB_FILE, JSON.stringify(cache, null, 2));
    writeScheduled = false;
  });
}

function nextId(collection) {
  return collection.reduce((max, item) => Math.max(max, item.id || 0), 0) + 1;
}

function logActivity(message, level = 'info') {
  cache.activity.unshift({
    id: nextId(cache.activity),
    message,
    level, // info | success | warn | error
    at: new Date().toISOString()
  });
  // cap history so the file doesn't grow forever
  if (cache.activity.length > 500) cache.activity.length = 500;
  persist();
}

module.exports = {
  get data() { return cache; },
  DATA_DIR,
  persist,
  nextId,
  logActivity,
  // Used by /system/restore to replace the whole dataset in place while
  // keeping the same object reference everything else already holds.
  replaceAll(newData) {
    for (const key of Object.keys(cache)) delete cache[key];
    Object.assign(cache, newData);
    persist();
  }
};
