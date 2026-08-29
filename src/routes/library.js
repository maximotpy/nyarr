const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { enqueueDownload, currentLibraryRoot } = require('../downloader');

const router = express.Router();

router.get('/library', (req, res) => {
  const { status, source, tagSetId, q, page = 1, pageSize = 40 } = req.query;
  let posts = [...db.data.posts];

  if (status) posts = posts.filter((p) => p.status === status);
  if (source) posts = posts.filter((p) => p.source === source);
  if (tagSetId) posts = posts.filter((p) => p.tagSetId === Number(tagSetId));
  if (q) {
    const needle = q.toLowerCase();
    posts = posts.filter((p) => p.tags.some((t) => t.toLowerCase().includes(needle)));
  }

  posts.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

  const total = posts.length;
  const start = (Number(page) - 1) * Number(pageSize);
  const pageItems = posts.slice(start, start + Number(pageSize));

  res.json({ total, page: Number(page), pageSize: Number(pageSize), items: pageItems });
});

router.post('/library/:id/download', (req, res) => {
  const id = Number(req.params.id);
  const post = db.data.posts.find((p) => p.id === id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  enqueueDownload(id);
  res.json({ ok: true });
});

router.delete('/library/:id', (req, res) => {
  const id = Number(req.params.id);
  const idx = db.data.posts.findIndex((p) => p.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const [removed] = db.data.posts.splice(idx, 1);
  // Only delete the actual file for stuff nyarr downloaded itself — never
  // delete the source file for a library-imported entry, since that's
  // pointing at a folder the user already had outside the app.
  if (removed.filePath && !removed.external) {
    const abs = path.join(currentLibraryRoot(), removed.filePath);
    fs.unlink(abs, () => {});
  }
  db.persist();
  res.status(204).end();
});

const IMPORTABLE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'webm', 'apng', 'avif']);
const MAX_WALK_DEPTH = 8;

function walk(dir, results, depth = 0) {
  if (depth > MAX_WALK_DEPTH) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory — skip it rather than failing the whole scan
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, results, depth + 1);
    else if (IMPORTABLE_EXTS.has(path.extname(entry.name).slice(1).toLowerCase())) {
      results.push(full);
    }
  }
}

router.post('/library/import', (req, res) => {
  const importPath = (req.body.path || '').trim();
  if (!importPath) return res.status(400).json({ error: 'path is required' });
  if (!fs.existsSync(importPath) || !fs.statSync(importPath).isDirectory()) {
    return res.status(400).json({ error: `Not a directory (or doesn't exist): ${importPath}` });
  }

  const found = [];
  walk(importPath, found);

  const root = currentLibraryRoot();
  const knownAbsolutePaths = new Set(
    db.data.posts
      .filter((p) => p.filePath)
      .map((p) => path.resolve(p.external ? p.filePath : path.join(root, p.filePath)))
  );

  let imported = 0;
  let skipped = 0;
  for (const full of found) {
    const resolved = path.resolve(full);
    if (knownAbsolutePaths.has(resolved)) { skipped++; continue; }

    // If the imported file happens to live under the current library root,
    // store it the same way a normal download would be (relative path) so
    // it behaves identically. Otherwise keep it as an absolute, external
    // reference to wherever the user's existing folder actually is.
    const relToRoot = path.relative(root, resolved);
    const isInsideRoot = !relToRoot.startsWith('..') && !path.isAbsolute(relToRoot);

    const record = {
      id: db.nextId(db.data.posts),
      source: 'manual',
      sourcePostId: path.basename(resolved, path.extname(resolved)),
      sourcePageUrl: null,
      tagSetId: null,
      tags: [],
      rating: 'unknown',
      score: 0,
      fileUrl: null,
      previewUrl: null,
      width: null,
      height: null,
      md5: null,
      ext: path.extname(resolved).slice(1),
      postedAt: null,
      status: 'downloaded',
      filePath: isInsideRoot ? relToRoot : resolved,
      external: !isInsideRoot,
      addedAt: new Date().toISOString()
    };
    record.previewUrl = `/library-files/${record.id}`;
    db.data.posts.push(record);
    imported++;
  }

  db.persist();
  db.logActivity(
    `Imported ${imported} file(s) from ${importPath}${skipped ? ` (${skipped} already in library)` : ''}`,
    imported ? 'success' : 'info'
  );
  res.json({ imported, skipped, scanned: found.length });
});

module.exports = router;
