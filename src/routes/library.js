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
    fs.unlink(abs, () => { });
  }
  db.persist();
  res.status(204).end();
});

// ---------- tag hierarchy ----------

// Folder name for the generated tag hierarchy inside the library root.
// The import scanner skips it so re-importing the library doesn't create
// duplicate "manual" posts for the hardlinked/copied files.
const TAG_HIERARCHY_DIR = 'by-tag';
// Tags that are too generic to be useful as top-level grouping buckets —
// every booru post carries these, so they'd each swallow the whole library.
const GENERIC_TAGS = new Set(['highres', 'lowres', 'absurdres', 'compressed', 'jpeg_artifacts', 'wide_shot', 'very_wide_shot']);

function downloadedPosts() {
  return db.data.posts.filter((p) => p.status === 'downloaded' && p.filePath);
}

// Deterministic pseudo-random pick: hashing the tag name means the same
// tag always showcases the same image (until its post set changes), which
// keeps the poster wall stable across re-renders instead of flickering
// to a new random image every time the page loads.
function pickSample(tag, posts) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  return posts[hash % posts.length];
}

function sanitizeTagDir(tag) {
  // Strip characters that are illegal or awkward in folder names on
  // Windows/Linux alike, then collapse whitespace.
  return tag.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim() || '_';
}

router.get('/library/tags', (req, res) => {
  const posts = downloadedPosts();
  const byTag = new Map();
  for (const p of posts) {
    for (const tag of p.tags || []) {
      if (GENERIC_TAGS.has(tag)) continue;
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag).push(p);
    }
  }

  const groups = [...byTag.entries()]
    .map(([tag, groupPosts]) => {
      const sample = pickSample(tag, groupPosts);
      return {
        tag,
        count: groupPosts.length,
        samplePostId: sample ? sample.id : null,
        // Serve the actual file (not the booru preview URL) so the wall
        // works offline and for external/manual imports too.
        sampleUrl: sample ? `/library-files/${sample.id}` : null
      };
    })
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

  res.json({ total: groups.length, groups });
});

// Materialize the tag hierarchy on disk under <libraryRoot>/by-tag/<tag>/.
// Uses hardlinks when possible (instant, no extra disk space) and falls
// back to copying for cross-device or filesystems that refuse links.
// External (absolute-path) posts are copied, never linked, since their
// source lives outside our control.
function linkOrCopy(src, dest) {
  try {
    fs.linkSync(src, dest);
    return 'linked';
  } catch {
    fs.copyFileSync(src, dest);
    return 'copied';
  }
}

router.post('/library/organize', (req, res) => {
  const root = currentLibraryRoot();
  const base = path.join(root, TAG_HIERARCHY_DIR);
  fs.mkdirSync(base, { recursive: true });

  const posts = downloadedPosts();
  let linked = 0, copied = 0, failed = 0;
  const failures = [];

  for (const post of posts) {
    const src = post.external ? post.filePath : path.join(root, post.filePath);
    if (!fs.existsSync(src)) { failed++; failures.push(`${post.source}:${post.sourcePostId} (file missing)`); continue; }

    const tags = (post.tags || []).filter((t) => !GENERIC_TAGS.has(t));
    // A post with no usable tags still gets filed under a catch-all so it
    // isn't silently dropped from the hierarchy.
    const dirs = tags.length ? tags : ['_untagged'];

    for (const tag of dirs) {
      const dir = path.join(base, sanitizeTagDir(tag));
      fs.mkdirSync(dir, { recursive: true });
      const ext = path.extname(post.filePath) || `.${post.ext || 'jpg'}`;
      const dest = path.join(dir, `${post.source}_${post.sourcePostId}${ext}`);
      try {
        if (fs.existsSync(dest)) { continue; }
        const how = linkOrCopy(src, dest);
        if (how === 'linked') linked++; else copied++;
      } catch (err) {
        failed++;
        failures.push(`${post.source}:${post.sourcePostId} -> ${tag}: ${err.message}`);
      }
    }
  }

  const summary = `Organized ${posts.length} post(s) into ${TAG_HIERARCHY_DIR}/ — ${linked} linked, ${copied} copied${failed ? `, ${failed} failed` : ''}`;
  db.logActivity(summary, failed ? 'warn' : 'success');
  res.json({ ok: true, posts: posts.length, linked, copied, failed, failures: failures.slice(0, 20), summary });
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
    if (entry.isDirectory()) {
      // Skip the generated tag hierarchy so re-importing the library root
      // doesn't create duplicate manual posts for the linked/copied files.
      if (depth === 0 && entry.name === TAG_HIERARCHY_DIR) continue;
      walk(full, results, depth + 1);
    } else if (IMPORTABLE_EXTS.has(path.extname(entry.name).slice(1).toLowerCase())) {
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
