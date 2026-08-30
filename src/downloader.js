const fs = require('fs');
const path = require('path');
const db = require('./db');

let processing = false;

function currentLibraryRoot() {
  return db.data.general.libraryRoot;
}

function enqueueDownload(postId) {
  const post = db.data.posts.find((p) => p.id === postId);
  if (!post) return;
  if (post.status === 'downloaded' || post.status === 'downloading') return;
  if (!post.fileUrl) {
    post.status = 'failed';
    post.error = 'No file URL available for this post';
    db.persist();
    return;
  }
  post.status = 'queued';
  db.persist();
  processQueue();
}

async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const post = db.data.posts.find((p) => p.status === 'queued');
      if (!post) break;
      await downloadOne(post);
    }
  } finally {
    processing = false;
  }
}

async function downloadOne(post) {
  post.status = 'downloading';
  db.persist();
  try {
    const root = currentLibraryRoot();
    const dir = path.join(root, post.source);
    fs.mkdirSync(dir, { recursive: true });
    const ext = post.ext || 'jpg';
    const filename = `${post.sourcePostId}.${ext}`;
    const filePath = path.join(dir, filename);

    const res = await fetch(post.fileUrl, { headers: { 'User-Agent': 'nyarr/0.1' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} downloading file`);
    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer));

    post.status = 'downloaded';
    // Stored relative to the *current* library root, not as an absolute
    // path, so moving the root later doesn't orphan old records, and the
    // file-serving route can resolve it against whatever root is active.
    post.filePath = path.join(post.source, filename);
    post.downloadedAt = new Date().toISOString();
    post.error = null;
    db.logActivity(`Downloaded ${post.source}:${post.sourcePostId} -> ${post.filePath}`, 'success');
  } catch (err) {
    post.status = 'failed';
    post.error = err.message;
    db.logActivity(`Download failed for ${post.source}:${post.sourcePostId}: ${err.message}`, 'error');
  }
  db.persist();
}

module.exports = { enqueueDownload, processQueue, currentLibraryRoot };
