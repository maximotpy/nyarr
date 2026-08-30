const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/activity', (req, res) => {
  res.json(db.data.activity.slice(0, 100));
});

// Latest files that finished downloading, newest first.
router.get('/downloads/recent', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 8, 50);
  const items = db.data.posts
    .filter((p) => p.status === 'downloaded' && p.filePath)
    .sort((a, b) => new Date(b.downloadedAt || b.addedAt) - new Date(a.downloadedAt || a.addedAt))
    .slice(0, limit)
    .map((p) => ({
      id: p.id,
      source: p.source,
      sourcePostId: p.sourcePostId,
      filePath: p.filePath,
      ext: p.ext,
      tags: (p.tags || []).slice(0, 5),
      downloadedAt: p.downloadedAt || p.addedAt
    }));
  res.json(items);
});

router.get('/stats', (req, res) => {
  const posts = db.data.posts;
  res.json({
    tagSets: db.data.tagSets.length,
    tagSetsEnabled: db.data.tagSets.filter((t) => t.enabled).length,
    totalPosts: posts.length,
    downloaded: posts.filter((p) => p.status === 'downloaded').length,
    queued: posts.filter((p) => p.status === 'queued' || p.status === 'downloading').length,
    failed: posts.filter((p) => p.status === 'failed').length,
    new: posts.filter((p) => p.status === 'new').length
  });
});

module.exports = router;
