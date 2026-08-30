const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { currentLibraryRoot } = require('../downloader');

const router = express.Router();

// Deliberately looks files up by post ID rather than accepting a raw path
// in the URL, that keeps this route from being a path-traversal vector
// even though library imports can point at arbitrary folders on disk.
router.get('/library-files/:id', (req, res) => {
  const post = db.data.posts.find((p) => p.id === Number(req.params.id));
  if (!post || !post.filePath) return res.status(404).send('Not found');
  const abs = post.external ? post.filePath : path.join(currentLibraryRoot(), post.filePath);
  if (!fs.existsSync(abs)) return res.status(404).send('File missing on disk');
  res.sendFile(path.resolve(abs));
});

module.exports = router;
