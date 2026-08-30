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

// Batch operations on tag sets. Body: { action, ids }
//   action: 'enable' | 'disable' — flip the enabled flag
//   action: 'search'             — run search-now on each (fire-and-forget;
//           results land in the activity feed as each run finishes)
//   action: 'delete'             — remove the tag sets (downloads are kept)
router.post('/tagsets/batch', async (req, res) => {
  const { action, ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: 'ids array is required' });
  }
  const wanted = new Set(ids.map(Number));
  const targets = db.data.tagSets.filter((t) => wanted.has(t.id));

  if (action === 'enable' || action === 'disable') {
    const enabled = action === 'enable';
    targets.forEach((t) => { t.enabled = enabled; });
    db.persist();
    db.logActivity(`Batch ${action}: ${targets.length} tag set(s)`, 'info');
    return res.json({ ok: true, affected: targets.length });
  }

  if (action === 'search') {
    // Kick every run off without awaiting — a full backfill on several tag
    // sets can take minutes, and the HTTP request shouldn't hang on it.
    targets.forEach((t) => {
      scheduler.runTagSet(t, { manual: true }).catch(() => { /* logged inside */ });
    });
    db.logActivity(`Batch search started for ${targets.length} tag set(s)`, 'info');
    return res.json({ ok: true, started: targets.length });
  }

  if (action === 'delete') {
    for (const t of targets) {
      const idx = db.data.tagSets.indexOf(t);
      if (idx !== -1) db.data.tagSets.splice(idx, 1);
    }
    db.persist();
    db.logActivity(`Batch delete: removed ${targets.length} tag set(s)`, 'info');
    return res.json({ ok: true, deleted: targets.length });
  }

  return res.status(400).json({ error: 'Unknown action — use enable, disable, search or delete' });
});

module.exports = router;
