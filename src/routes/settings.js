const express = require('express');
const db = require('../db');
const indexers = require('../indexers');

const router = express.Router();

router.get('/indexers', (req, res) => {
  res.json(indexers.list());
});

router.get('/settings', (req, res) => {
  res.json(db.data.settings);
});

router.put('/settings/:indexerId', (req, res) => {
  const { indexerId } = req.params;
  if (!db.data.settings[indexerId]) {
    return res.status(404).json({ error: `Unknown indexer: ${indexerId}` });
  }
  db.data.settings[indexerId] = { ...db.data.settings[indexerId], ...req.body };
  db.persist();
  res.json(db.data.settings[indexerId]);
});

router.post('/settings/:indexerId/test', async (req, res) => {
  const { indexerId } = req.params;
  try {
    const indexer = indexers.get(indexerId);
    const result = await indexer.testConnection(db.data.settings[indexerId]);
    if (result.ok) {
      db.logActivity(`Connection test for ${indexer.label} succeeded`, 'success');
      res.json(result);
    } else {
      db.logActivity(`Connection test for ${indexer.label} failed: ${result.error}`, 'error');
      res.status(400).json(result);
    }
  } catch (err) {
    db.logActivity(`Connection test for ${indexerId} failed: ${err.message}`, 'error');
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
