const db = require('./db');
const indexers = require('./indexers');
const { ratingAllowed } = require('./indexers/base');
const { enqueueDownload } = require('./downloader');

// How many pages to walk on a tag set's very first check, so a freshly
// created tag set backfills some history instead of only catching posts
// from this point forward. Overridden by tagSet.maxPages when set.
const INITIAL_BACKFILL_PAGES = 3;
const PAGE_LIMIT = 100; // most booru APIs cap a single request at 100 posts
// Politeness delay between consecutive page requests to the same booru
// (milliseconds). Keeps a full-history backfill from hammering the API.
const PAGE_DELAY_MS = 750;
// Hard ceiling on pages per run as a runaway guard (100 pages = 10k posts
// per tag set per run). tagSet.maxPages can lower this, never raise it.
const ABSOLUTE_MAX_PAGES = 100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runTagSet(tagSet, { manual = false } = {}) {
  const indexer = indexers.get(tagSet.source);
  const credentials = db.data.settings[tagSet.source] || {};
  const isFirstRun = !tagSet.lastChecked;

  // Page budget for this run:
  //  - explicit maxPages on the tag set wins (0 = unlimited, capped only
  //    by ABSOLUTE_MAX_PAGES as a runaway guard)
  //  - otherwise first runs backfill INITIAL_BACKFILL_PAGES and recurring
  //    checks walk 1 page... unless the previous run hit its budget, in
  //    which case keep walking (the tag has more history than one pass
  //    could reach — see tagSet.backfillComplete below).
  // Capped tag sets (explicit maxPages) resume from where the previous
  // run stopped via backfillCursor, so successive runs eventually cover
  // the whole history instead of re-reading page 1 forever.
  let startPage = 1;
  let pagesToWalk;
  if (tagSet.maxPages !== undefined && tagSet.maxPages !== null) {
    pagesToWalk = tagSet.maxPages === 0 ? ABSOLUTE_MAX_PAGES : Math.min(tagSet.maxPages, ABSOLUTE_MAX_PAGES);
    if (!isFirstRun && !tagSet.backfillComplete) {
      startPage = Math.max(1, tagSet.backfillCursor || 1);
    }
  } else if (isFirstRun) {
    pagesToWalk = INITIAL_BACKFILL_PAGES;
  } else if (tagSet.backfillComplete) {
    pagesToWalk = 1;
  } else {
    // Mid-backfill: resume from where the previous run stopped.
    startPage = Math.max(1, tagSet.backfillCursor || 1);
    pagesToWalk = ABSOLUTE_MAX_PAGES;
  }
  // A single-page catch-up run (backfill already done) shouldn't flip the
  // flag back to incomplete just because page 1 came back full — new posts
  // naturally fill it. Only actual backfill runs can clear the flag.
  const isCatchUpRun = !isFirstRun && tagSet.backfillComplete && pagesToWalk === 1;

  let inserted = 0;
  let seen = 0;
  let hitEmptyPage = false;
  let lastPageWalked = startPage - 1;

  try {
    for (let page = startPage; page < startPage + pagesToWalk; page++) {
      if (page > startPage) await sleep(PAGE_DELAY_MS);
      const results = await indexer.search({
        tags: tagSet.tags,
        page,
        limit: PAGE_LIMIT,
        credentials
      });
      seen += results.length;
      lastPageWalked = page;
      // A short page means we've walked past the end of this tag's
      // history — no point requesting further pages.
      if (results.length < PAGE_LIMIT) hitEmptyPage = true;
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
      if (!isFirstRun && tagSet.backfillComplete) break;
    }

    // Remember whether the full history has been reached: once a run ends
    // on a short/empty page, later recurring checks only need 1 page to
    // catch new posts. If we ran out of budget instead, the next run
    // resumes the backfill from where this one stopped.
    if (!isCatchUpRun) {
      tagSet.backfillComplete = hitEmptyPage;
      tagSet.backfillCursor = hitEmptyPage ? 1 : lastPageWalked + 1;
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
