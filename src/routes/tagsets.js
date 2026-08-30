const express = require('express');
const db = require('../db');
const scheduler = require('../scheduler');

const router = express.Router();

function withCounts(tagSet) {
  const posts = db.data.posts.filter((p) => p.tagSetId === tagSet.id);
  return {
    ...tagSet,
    postCount: posts.length,
    downloadedCount: posts.filter((p) => p.status === 'downloaded').length
  };
}

router.get('/tagsets', (req, res) => {
  res.json(db.data.tagSets.map(withCounts));
});

router.post('/tagsets', (req, res) => {
  const { name, source, tags, ratingFilter, minScore, intervalMinutes, autoDownload, enabled, maxPages } = req.body;
  if (!name || !source || !tags) {
    return res.status(400).json({ error: 'name, source and tags are required' });
  }
  const tagSet = {
    id: db.nextId(db.data.tagSets),
    name,
    source,
    tags,
    ratingFilter: ratingFilter || 'safe_questionable',
    minScore: Number(minScore) || 0,
    intervalMinutes: Number(intervalMinutes) || 60,
    // null = auto (3 pages on first run, then catch-up-as-needed); a
    // number = fixed page budget per run, 0 = walk everything.
    maxPages: maxPages === undefined ? null : (maxPages === null ? null : Math.max(0, Number(maxPages) || 0)),
    autoDownload: Boolean(autoDownload),
    enabled: enabled !== undefined ? Boolean(enabled) : true,
    lastChecked: null,
    lastError: null,
    createdAt: new Date().toISOString()
  };
  db.data.tagSets.push(tagSet);
  db.persist();
  db.logActivity(`Created tag set "${tagSet.name}" (${tagSet.source})`);
  res.status(201).json(withCounts(tagSet));
});

router.put('/tagsets/:id', (req, res) => {
  const id = Number(req.params.id);
  const tagSet = db.data.tagSets.find((t) => t.id === id);
  if (!tagSet) return res.status(404).json({ error: 'Not found' });
  const fields = ['name', 'source', 'tags', 'ratingFilter', 'minScore', 'intervalMinutes', 'autoDownload', 'enabled', 'maxPages'];
  for (const f of fields) {
    if (req.body[f] !== undefined) tagSet[f] = req.body[f];
  }
  db.persist();
  res.json(withCounts(tagSet));
});

router.delete('/tagsets/:id', (req, res) => {
  const id = Number(req.params.id);
  const idx = db.data.tagSets.findIndex((t) => t.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const [removed] = db.data.tagSets.splice(idx, 1);
  db.persist();
  db.logActivity(`Deleted tag set "${removed.name}"`);
  res.status(204).end();
});

router.post('/tagsets/:id/search-now', async (req, res) => {
  const id = Number(req.params.id);
  const tagSet = db.data.tagSets.find((t) => t.id === id);
  if (!tagSet) return res.status(404).json({ error: 'Not found' });
  try {
    const result = await scheduler.runTagSet(tagSet, { manual: true });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

module.exports = router;
