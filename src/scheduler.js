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
  // A tag set can watch one or several indexers. Older tag sets only have
  // the legacy `source` field, normalize it into a list.
  const sourceIds = Array.isArray(tagSet.sources) && tagSet.sources.length
    ? tagSet.sources
    : [tagSet.source];
  const isFirstRun = !tagSet.lastChecked;

  // Page budget for this run:
  //  - explicit maxPages on the tag set wins (0 = unlimited, capped only
  //    by ABSOLUTE_MAX_PAGES as a runaway guard)
  //  - otherwise first runs backfill INITIAL_BACKFILL_PAGES and recurring
  //    checks walk 1 page... unless the previous run hit its budget, in
  //    which case keep walking (the tag has more history than one pass
  //    could reach, see tagSet.backfillComplete below).
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
  // flag back to incomplete just because page 1 came back full, new posts
  // naturally fill it. Only actual backfill runs can clear the flag.
  const isCatchUpRun = !isFirstRun && tagSet.backfillComplete && pagesToWalk === 1;

  let inserted = 0;
  let seen = 0;
  const perSource = [];
  const errors = [];

  try {
    for (const sourceId of sourceIds) {
      const result = await runTagSetOnSource(tagSet, sourceId, { manual, isFirstRun });
      inserted += result.inserted;
      seen += result.seen;
      perSource.push({ source: sourceId, inserted: result.inserted, seen: result.seen });
      if (result.error) errors.push(`${sourceId}: ${result.error}`);
    }

    tagSet.lastChecked = new Date().toISOString();
    tagSet.lastError = errors.length
      ? `${errors.length}/${sourceIds.length} source(s) failed: ${errors.map((e) => e.split(':')[0]).join(', ')}`
      : null;
    db.persist();

    if (inserted > 0 || manual) {
      db.logActivity(
        `"${tagSet.name}" (${sourceIds.join(', ')}): checked ${seen} post(s), found ${inserted} new` +
        (errors.length ? `, ${errors.length}/${sourceIds.length} source(s) errored` : ''),
        inserted > 0 ? 'success' : 'info'
      );
    }
  } catch (err) {
    tagSet.lastChecked = new Date().toISOString();
    tagSet.lastError = err.message;
    db.persist();
    db.logActivity(`"${tagSet.name}" failed: ${err.message}`, 'error');
    throw err;
  }

  return { seen, inserted, perSource, errors };
}

// Run one tag set against a single indexer. Each source keeps its own
// backfill cursor/flag so a multi-source tag set backfills each booru
// independently (tagSet.backfillCursors[sourceId]).
async function runTagSetOnSource(tagSet, sourceId, { manual, isFirstRun }) {
  const indexer = indexers.get(sourceId);
  const credentials = db.data.settings[sourceId] || {};
  const cursors = tagSet.backfillCursors || (tagSet.backfillCursors = {});
  const state = cursors[sourceId] || (cursors[sourceId] = { complete: false, cursor: 1 });

  // Page budget for this run (same policy as before, but per source):
  let startPage = 1;
  let pagesToWalk;
  if (tagSet.maxPages !== undefined && tagSet.maxPages !== null) {
    pagesToWalk = tagSet.maxPages === 0 ? ABSOLUTE_MAX_PAGES : Math.min(tagSet.maxPages, ABSOLUTE_MAX_PAGES);
    if (!isFirstRun && !state.complete) {
      startPage = Math.max(1, state.cursor || 1);
    }
  } else if (isFirstRun) {
    pagesToWalk = INITIAL_BACKFILL_PAGES;
  } else if (state.complete) {
    pagesToWalk = 1;
  } else {
    startPage = Math.max(1, state.cursor || 1);
    pagesToWalk = ABSOLUTE_MAX_PAGES;
  }
  const isCatchUpRun = !isFirstRun && state.complete && pagesToWalk === 1;

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
      if (results.length < PAGE_LIMIT) hitEmptyPage = true;
      if (results.length === 0) break;

      for (const post of results) {
        if (!ratingAllowed(post.rating, tagSet.ratingFilter)) continue;
        if ((post.score ?? 0) < (tagSet.minScore ?? 0)) continue;

        const dupeById = db.data.posts.find(
          (p) => p.source === sourceId && p.sourcePostId === post.sourcePostId
        );
        const dupeByHash = post.md5 && db.data.posts.find((p) => p.md5 === post.md5);
        if (dupeById || dupeByHash) continue;

        const record = {
          id: db.nextId(db.data.posts),
          source: sourceId,
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
      if (!isFirstRun && state.complete) break;
    }

    if (!isCatchUpRun) {
      state.complete = hitEmptyPage;
      state.cursor = hitEmptyPage ? 1 : lastPageWalked + 1;
    }

    return { seen, inserted, error: null };
  } catch (err) {
    // One failing source shouldn't abort the others, report and continue.
    return { seen, inserted, error: err.message };
  }
}

// Artist watches are like tag sets, but instead of being pinned to a single
// booru they search the artist tag on EVERY indexer at once, so one watch
// pulls in everything the app can find for that artist across all sources.
// Per-source page budgets are tracked independently (artist.pageCursors)
// since each booru has its own history depth and rate limits.
async function runArtist(artist, { manual = false } = {}) {
  const isFirstRun = !artist.lastChecked;
  const pageCursors = artist.pageCursors || {};

  // Same budget logic as tag sets: explicit maxPages wins (0 = unlimited,
  // capped by ABSOLUTE_MAX_PAGES), otherwise first runs backfill a few
  // pages and recurring checks walk 1 page per source until each source's
  // backfill completes (short page reached).
  let pagesToWalk;
  if (artist.maxPages !== undefined && artist.maxPages !== null) {
    pagesToWalk = artist.maxPages === 0 ? ABSOLUTE_MAX_PAGES : Math.min(artist.maxPages, ABSOLUTE_MAX_PAGES);
  } else if (isFirstRun) {
    pagesToWalk = INITIAL_BACKFILL_PAGES;
  } else {
    pagesToWalk = 1;
  }

  let inserted = 0;
  let seen = 0;
  const perSource = [];
  const errors = [];

  // Only query indexers the user has actually added (credentials entered in
  // Settings → Indexers). Unconfigured sources would just 401/404 and bury
  // real results under a wall of errors.
  const sources = indexers.configuredIds();
  if (!sources.length) {
    artist.lastChecked = new Date().toISOString();
    artist.lastError = 'No indexers configured, add at least one in Settings → Indexers';
    db.persist();
    return { seen: 0, inserted: 0, perSource: [], errors: [artist.lastError] };
  }

  // Search terms for this watch: always the artist tag, plus the display
  // name as a plain tag when alsoSearchNameAsTag is on (some boorus credit
  // the artist as a regular tag rather than under the artist tag namespace).
  // Both terms share the same per-source page cursor, the cursor tracks
  // how far we've walked the combined result stream, and the md5/id dedupe
  // below absorbs any overlap between the two searches.
  const searchTerms = [artist.artistTag];
  if (artist.alsoSearchNameAsTag && artist.name && artist.name !== artist.artistTag) {
    searchTerms.push(artist.name);
  }

  for (const id of sources) {
    const indexer = indexers.get(id);
    const credentials = db.data.settings[id] || {};
    const startPage = Math.max(1, pageCursors[id] || 1);
    let lastPageWalked = startPage - 1;
    let hitEmptyPage = false;
    let sourceInserted = 0;

    try {
      for (const term of searchTerms) {
        for (let page = startPage; page < startPage + pagesToWalk; page++) {
          if (page > startPage) await sleep(PAGE_DELAY_MS);
          const results = await indexer.search({
            tags: term,
            page,
            limit: PAGE_LIMIT,
            credentials
          });
          seen += results.length;
          lastPageWalked = page;
          if (results.length < PAGE_LIMIT) hitEmptyPage = true;
          if (results.length === 0) break;

          for (const post of results) {
            if (!ratingAllowed(post.rating, artist.ratingFilter)) continue;
            if ((post.score ?? 0) < (artist.minScore ?? 0)) continue;

            // Dedupe across sources by md5 too, the same artwork is often
            // reposted on multiple boorus, and we only want one library entry.
            const dupeById = db.data.posts.find(
              (p) => p.source === id && p.sourcePostId === post.sourcePostId
            );
            const dupeByHash = post.md5 && db.data.posts.find((p) => p.md5 === post.md5);
            if (dupeById || dupeByHash) continue;

            const record = {
              id: db.nextId(db.data.posts),
              source: id,
              sourcePostId: post.sourcePostId,
              sourcePageUrl: post.sourcePageUrl,
              artistId: artist.id,
              tagSetId: null,
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
            sourceInserted++;

            if (artist.autoDownload && record.fileUrl) {
              enqueueDownload(record.id);
            }
          }
          // Recurring catch-up runs only need page 1 per source once the
          // backfill has completed for that source.
          if (!isFirstRun && hitEmptyPage) break;
        }
      }

      // Track per-source backfill position: once a source hits a short
      // page its history is exhausted, so future runs start at page 1.
      pageCursors[id] = hitEmptyPage ? 1 : lastPageWalked + 1;
      perSource.push({ source: id, inserted: sourceInserted });
    } catch (err) {
      // One broken indexer (missing credentials, rate limit, downtime)
      // shouldn't stop the other sources from being searched.
      errors.push(`${indexer.label}: ${err.message}`);
      perSource.push({ source: id, inserted: 0, error: err.message });
    }
  }

  artist.pageCursors = pageCursors;
  artist.lastChecked = new Date().toISOString();
  // Keep the stored error short, full per-source details are returned to
  // the caller and shown in the UI; a giant HTML blob in db.json helps nobody.
  artist.lastError = errors.length
    ? `${errors.length}/${sources.length} source(s) failed: ${errors.map((e) => e.split(':')[0]).join(', ')}`
    : null;
  db.persist();

  if (inserted > 0 || manual) {
    db.logActivity(
      `"${artist.name}" (all indexers): checked ${seen} post(s), found ${inserted} new` +
      (errors.length ? `, ${errors.length}/${perSource.length} source(s) errored` : ''),
      errors.length && inserted === 0 ? 'warn' : inserted > 0 ? 'success' : 'info'
    );
  }

  return { seen, inserted, perSource, errors };
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
  for (const artist of db.data.artists) {
    if (!artist.enabled) continue;
    const dueAt = artist.lastChecked
      ? new Date(artist.lastChecked).getTime() + artist.intervalMinutes * 60 * 1000
      : 0;
    if (now >= dueAt) {
      runArtist(artist).catch(() => {
        /* already logged inside runArtist */
      });
    }
  }
}

module.exports = { start, runTagSet, runArtist };
