const express = require('express');
const db = require('../db');
const scheduler = require('../scheduler');
const indexers = require('../indexers');

const router = express.Router();

function withCounts(artist) {
    const posts = db.data.posts.filter((p) => p.artistId === artist.id);
    return {
        ...artist,
        postCount: posts.length,
        downloadedCount: posts.filter((p) => p.status === 'downloaded').length
    };
}

router.get('/artists', (req, res) => {
    res.json(db.data.artists.map(withCounts));
});

router.post('/artists', (req, res) => {
    const { name, artistTag, ratingFilter, minScore, intervalMinutes, autoDownload, enabled, maxPages } = req.body;
    if (!name || !artistTag) {
        return res.status(400).json({ error: 'name and artistTag are required' });
    }
    const artist = {
        id: db.nextId(db.data.artists),
        name,
        // The booru artist tag to search for, e.g. "wlop". Searched on every
        // indexer at once — unlike tag sets, which are pinned to one source.
        artistTag,
        ratingFilter: ratingFilter || 'safe_questionable',
        minScore: Number(minScore) || 0,
        intervalMinutes: Number(intervalMinutes) || 60,
        // Same page-budget semantics as tag sets: null = auto backfill then
        // catch up, a number = fixed budget per run, 0 = walk everything.
        maxPages: maxPages === undefined ? null : (maxPages === null ? null : Math.max(0, Number(maxPages) || 0)),
        autoDownload: Boolean(autoDownload),
        enabled: enabled !== undefined ? Boolean(enabled) : true,
        lastChecked: null,
        lastError: null,
        createdAt: new Date().toISOString()
    };
    db.data.artists.push(artist);
    db.persist();
    db.logActivity(`Created artist watch "${artist.name}" (${artist.artistTag})`);
    res.status(201).json(withCounts(artist));
});

router.put('/artists/:id', (req, res) => {
    const id = Number(req.params.id);
    const artist = db.data.artists.find((a) => a.id === id);
    if (!artist) return res.status(404).json({ error: 'Not found' });
    const fields = ['name', 'artistTag', 'ratingFilter', 'minScore', 'intervalMinutes', 'autoDownload', 'enabled', 'maxPages'];
    for (const f of fields) {
        if (req.body[f] !== undefined) artist[f] = req.body[f];
    }
    db.persist();
    res.json(withCounts(artist));
});

router.delete('/artists/:id', (req, res) => {
    const id = Number(req.params.id);
    const idx = db.data.artists.findIndex((a) => a.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const [removed] = db.data.artists.splice(idx, 1);
    db.persist();
    db.logActivity(`Deleted artist watch "${removed.name}"`);
    res.status(204).end();
});

router.post('/artists/:id/search-now', async (req, res) => {
    const id = Number(req.params.id);
    const artist = db.data.artists.find((a) => a.id === id);
    if (!artist) return res.status(404).json({ error: 'Not found' });
    try {
        const result = await scheduler.runArtist(artist, { manual: true });
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(502).json({ ok: false, error: err.message });
    }
});

// Batch operations on artist watches. Body: { action, ids }
//   action: 'enable' | 'disable' — flip the enabled flag
//   action: 'search'             — run search-now on each (fire-and-forget)
//   action: 'delete'             — remove the watches (downloads are kept)
router.post('/artists/batch', async (req, res) => {
    const { action, ids } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) {
        return res.status(400).json({ error: 'ids array is required' });
    }
    const wanted = new Set(ids.map(Number));
    const targets = db.data.artists.filter((a) => wanted.has(a.id));

    if (action === 'enable' || action === 'disable') {
        const enabled = action === 'enable';
        targets.forEach((a) => { a.enabled = enabled; });
        db.persist();
        db.logActivity(`Batch ${action}: ${targets.length} artist watch(es)`, 'info');
        return res.json({ ok: true, affected: targets.length });
    }

    if (action === 'search') {
        targets.forEach((a) => {
            scheduler.runArtist(a, { manual: true }).catch(() => { /* logged inside */ });
        });
        db.logActivity(`Batch search started for ${targets.length} artist watch(es)`, 'info');
        return res.json({ ok: true, started: targets.length });
    }

    if (action === 'delete') {
        for (const a of targets) {
            const idx = db.data.artists.indexOf(a);
            if (idx !== -1) db.data.artists.splice(idx, 1);
        }
        db.persist();
        db.logActivity(`Batch delete: removed ${targets.length} artist watch(es)`, 'info');
        return res.json({ ok: true, deleted: targets.length });
    }

    return res.status(400).json({ error: 'Unknown action — use enable, disable, search or delete' });
});

// Quick "does this artist exist on which indexers?" probe — searches page 1
// with a tiny limit on every *configured* indexer in parallel and reports
// per-source result counts. Useful when adding an artist to see where they
// post. Unconfigured sources are skipped (they'd just 401/404).
router.get('/artists/lookup', async (req, res) => {
    const tag = String(req.query.tag || '').trim();
    if (!tag) return res.status(400).json({ error: 'tag query param is required' });

    const ids = indexers.configuredIds();
    const results = await Promise.all(
        ids.map(async (id) => {
            try {
                const indexer = indexers.get(id);
                const credentials = db.data.settings[id] || {};
                const posts = await indexer.search({ tags: tag, page: 1, limit: 5, credentials });
                return { source: id, label: indexer.label, ok: true, sampleCount: posts.length };
            } catch (err) {
                return { source: id, label: indexers.get(id).label, ok: false, error: err.message };
            }
        })
    );
    res.json({ tag, results });
});

module.exports = router;
