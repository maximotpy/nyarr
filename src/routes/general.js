const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('../db');
const { generateSalt, hashPassword, generateApiKey } = require('../auth');

const router = express.Router();

function publicGeneral() {
  // Never send the password hash/salt to the client.
  const { passwordHash, passwordSalt, ...safe } = db.data.general;
  return safe;
}

router.get('/general', (req, res) => {
  res.json(publicGeneral());
});

router.put('/general', (req, res) => {
  const g = db.data.general;
  const body = req.body || {};

  if (body.instanceName !== undefined) g.instanceName = String(body.instanceName).trim() || 'nyarr';

  if (body.port !== undefined) {
    const port = Number(body.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return res.status(400).json({ error: 'Port must be an integer between 1 and 65535' });
    }
    g.port = port;
  }

  if (body.libraryRoot !== undefined) {
    const libraryRoot = String(body.libraryRoot).trim();
    if (!libraryRoot) return res.status(400).json({ error: 'Library root cannot be empty' });
    try {
      fs.mkdirSync(libraryRoot, { recursive: true });
      fs.accessSync(libraryRoot, fs.constants.W_OK);
    } catch (err) {
      return res.status(400).json({ error: `Can't use "${libraryRoot}" as the library root: ${err.message}` });
    }
    g.libraryRoot = path.resolve(libraryRoot);
  }

  if (body.authMethod !== undefined) {
    if (!['none', 'basic'].includes(body.authMethod)) {
      return res.status(400).json({ error: 'authMethod must be "none" or "basic"' });
    }
    if (body.authMethod === 'basic') {
      const username = (body.username ?? g.username ?? '').trim();
      const hasExistingPassword = Boolean(g.passwordHash);
      const settingNewPassword = Boolean(body.password);
      if (!username) return res.status(400).json({ error: 'A username is required to enable authentication' });
      if (!hasExistingPassword && !settingNewPassword) {
        return res.status(400).json({ error: 'A password is required to enable authentication' });
      }
      g.username = username;
    }
    g.authMethod = body.authMethod;
  } else if (body.username !== undefined) {
    g.username = String(body.username).trim();
  }

  if (body.password) {
    g.passwordSalt = generateSalt();
    g.passwordHash = hashPassword(body.password, g.passwordSalt);
  }

  db.persist();
  db.logActivity('Updated general settings');
  res.json(publicGeneral());
});

router.post('/general/regenerate-api-key', (req, res) => {
  db.data.general.apiKey = generateApiKey();
  db.persist();
  db.logActivity('API key regenerated — any external API clients will need the new key');
  res.json({ apiKey: db.data.general.apiKey });
});

// Lightweight directory browser so the library-root field can offer a
// picker instead of demanding the user type an exact server-side path.
router.get('/system/browse', (req, res) => {
  const requested = req.query.path ? String(req.query.path) : os.homedir();
  let target;
  try {
    target = path.resolve(requested);
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) throw new Error('Not a directory');
  } catch (err) {
    return res.status(400).json({ error: `Can't browse "${requested}": ${err.message}` });
  }

  let entries = [];
  try {
    entries = fs.readdirSync(target, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch (err) {
    return res.status(400).json({ error: `Can't read "${target}": ${err.message}` });
  }

  const parent = path.dirname(target);
  res.json({ path: target, parent: parent === target ? null : parent, directories: entries });
});

router.get('/system/backup', (req, res) => {
  const filename = `nyarr-backup-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(db.data, null, 2));
});

router.post('/system/restore', (req, res) => {
  const incoming = req.body;
  const requiredKeys = ['general', 'settings', 'tagSets', 'posts', 'activity'];
  if (!incoming || typeof incoming !== 'object' || !requiredKeys.every((k) => k in incoming)) {
    return res.status(400).json({ error: 'That file doesn\'t look like a nyarr backup (missing expected fields).' });
  }
  db.replaceAll(incoming);
  db.logActivity('Restored data from an uploaded backup', 'warn');
  res.json({ ok: true });
});

module.exports = router;
