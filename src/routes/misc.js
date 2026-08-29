const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/activity', (req, res) => {
  res.json(db.data.activity.slice(0, 100));
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
