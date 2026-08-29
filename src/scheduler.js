const db = require('./db');
const indexers = require('./indexers');
const { ratingAllowed } = require('./indexers/base');
const { enqueueDownload } = require('./downloader');

// How many pages to walk on a tag set's very first check, so a freshly
// created tag set backfills some history instead of only catching posts
// from this point forward.
const INITIAL_BACKFILL_PAGES = 3;
const PAGE_LIMIT = 100;

async function runTagSet(tagSet, { manual = false } = {}) {
  const indexer = indexers.get(tagSet.source);
  const credentials = db.data.settings[tagSet.source] || {};
  const isFirstRun = !tagSet.lastChecked;
  const pagesToWalk = isFirstRun ? INITIAL_BACKFILL_PAGES : 1;

  let inserted = 0;
  let seen = 0;

  try {
    for (let page = 1; page <= pagesToWalk; page++) {
      const results = await indexer.search({
        tags: tagSet.tags,
        page,
        limit: PAGE_LIMIT,
        credentials
      });
      seen += results.length;
      if (results.length === 0) break;

      for (const post of results) {
        if (!ratingAllowed(post.rating, tagSet.ratingFilter)) continue;
        if ((post.score ?? 0) < (tagSet.minScore ?? 0)) continue;

        const dupeById = db.data.posts.find(
          (p) => p.source === tagSet.source && p.sourcePostId === post.sourcePostId
        );
        const dupeByHash = post.md5 && db.data.posts.find((p) => p.md5 === post.md5);
        if (dupeById || dupeByHash) continue;

        const record = {
          id: db.nextId(db.data.posts),
          source: tagSet.source,
          sourcePostId: post.sourcePostId,
          sourcePageUrl: post.sourcePageUrl,
          tagSetId: tagSet.id,
          tags: post.tags,
          rating: post.rating,
          score: post.score,
          fileUrl: post.fileUrl,
          previewUrl: post.previewUrl,
          width: post.width,
          height: post.height,
          md5: post.md5,
          ext: post.ext,
          postedAt: post.postedAt,
          status: 'new',
          filePath: null,
          addedAt: new Date().toISOString()
        };
        db.data.posts.push(record);
        inserted++;

        if (tagSet.autoDownload && record.fileUrl) {
          enqueueDownload(record.id);
        }
      }
      // Stop walking further back if this page had nothing new at all
      // (recurring checks only need to reach previously-seen territory).
      if (!isFirstRun) break;
    }

    tagSet.lastChecked = new Date().toISOString();
    tagSet.lastError = null;
    db.persist();

    if (inserted > 0 || manual) {
      db.logActivity(
        `"${tagSet.name}" (${indexer.label}): checked ${seen} post(s), found ${inserted} new`,
        inserted > 0 ? 'success' : 'info'
      );
    }
  } catch (err) {
    tagSet.lastChecked = new Date().toISOString();
    tagSet.lastError = err.message;
    db.persist();
    db.logActivity(`"${tagSet.name}" (${indexer.label}) failed: ${err.message}`, 'error');
    throw err;
  }

  return { seen, inserted };
}

let timer = null;

function start() {
  if (timer) return;
  // Tick every minute; each tag set decides for itself whether it's due
  // based on its own intervalMinutes.
  timer = setInterval(tick, 60 * 1000);
  tick();
}

function tick() {
  const now = Date.now();
  for (const tagSet of db.data.tagSets) {
    if (!tagSet.enabled) continue;
    const dueAt = tagSet.lastChecked
      ? new Date(tagSet.lastChecked).getTime() + tagSet.intervalMinutes * 60 * 1000
      : 0;
    if (now >= dueAt) {
      runTagSet(tagSet).catch(() => {
        /* already logged inside runTagSet */
      });
    }
  }
}

module.exports = { start, runTagSet };
