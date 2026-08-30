// Generic Gelbooru-style dapi adapter factory. Covers the whole family of
// boorus that expose a `/index.php?page=dapi&s=post&q=index&json=1` endpoint
// with a shared response shape: { post: [...] } or a bare array of posts.
//
// `pageParam`, the query param used to page; most dapi sites use the
// zero-indexed `pid` param (Gelbooru line), some use a 1-indexed `page`
// param (older APIs). Opt into pid only when that's correct for the site.
// `viewUrlBuilder`, build the human-facing /index.php?page=post&s=view page
// from baseUrl + post id.

const { normalizeRating, httpGetJson, extFromUrl } = require('./base');

function gelbooruFamilyAdapter({ label, defaultBaseUrl, pageParam = 'pid', md5Field = 'md5', requiresCredentials = false }) {
    async function search({ tags, page = 1, limit = 100, credentials = {} }) {
        const baseUrl = (credentials.baseUrl || defaultBaseUrl).replace(/\/$/, '');
        const params = new URLSearchParams({
            page: 'dapi',
            s: 'post',
            q: 'index',
            json: '1',
            tags: tags || '',
            limit: String(limit)
        });
        if (pageParam === 'pid') params.set('pid', String(Math.max(0, page - 1)));
        else params.set('page', String(page));
        if (credentials.apiKey) params.set('api_key', credentials.apiKey);
        if (credentials.userId) params.set('user_id', credentials.userId);

        const url = `${baseUrl}/index.php?${params.toString()}`;
        const raw = await httpGetJson(url, { headers: { 'User-Agent': 'nyarr/0.1' } });
        const posts = Array.isArray(raw) ? raw : (raw.post || raw['@attributes']?.post || []);

        return posts.map((p) => {
            const fileUrl = p.file_url || null;
            return {
                sourcePostId: String(p.id),
                tags: (p.tags || '').split(' ').filter(Boolean),
                rating: normalizeRating(p.rating || 'explicit'),
                score: p.score ?? 0,
                fileUrl,
                previewUrl: p.preview_url || p.sample_url || fileUrl,
                width: p.width ?? null,
                height: p.height ?? null,
                md5: p[md5Field] || p.hash || p.md5 || null,
                ext: extFromUrl(fileUrl) || extFromUrl(p.image),
                postedAt: p.created_at || (p.change ? new Date(Number(p.change) * 1000).toISOString() : null),
                sourcePageUrl: `${baseUrl.replace('api.', '')}/index.php?page=post&s=view&id=${p.id}`
            };
        });
    }

    async function testConnection(credentials = {}) {
        // Sites like Gelbooru/Realbooru hard-reject anonymous dapi calls with
        // 401, surface that as a failure with a hint instead of "reachable".
        if (requiresCredentials && (!credentials.apiKey || !credentials.userId)) {
            return {
                ok: false,
                authenticated: false,
                error: `${label} requires both an API key and a user ID for API access, enter both to test.`
            };
        }
        try {
            const posts = await search({ tags: '', page: 1, limit: 1, credentials });
            return { ok: true, authenticated: Boolean(credentials.apiKey && credentials.userId) || null, sample: posts.length };
        } catch (err) {
            if (err.status === 401 || err.status === 403) {
                return {
                    ok: false,
                    authenticated: false,
                    error: `${label} rejected the request (HTTP ${err.status}), check that the API key and user ID are correct.`
                };
            }
            throw err;
        }
    }

    return { search, testConnection };
}

// Danbooru-family adapter: sites exposing /posts.json with a Danbooru-shaped
// payload (id, file_url, preview_file_url, tag_string, rating, md5, etc.).
function danbooruFamilyAdapter({ label, defaultBaseUrl }) {
    async function search({ tags, page = 1, limit = 100, credentials = {} }) {
        const baseUrl = (credentials.baseUrl || defaultBaseUrl).replace(/\/$/, '');
        const params = new URLSearchParams({
            tags: tags || '',
            page: String(page),
            limit: String(limit)
        });
        if (credentials.apiKey) params.set('api_key', credentials.apiKey);
        if (credentials.username) params.set('login', credentials.username);

        const url = `${baseUrl}/posts.json?${params.toString()}`;
        const raw = await httpGetJson(url, { headers: { 'User-Agent': 'nyarr/0.1' } });

        return raw.map((p) => {
            const fileUrl = p.file_url || p.large_file_url || null;
            return {
                sourcePostId: String(p.id),
                tags: (p.tag_string || '').split(' ').filter(Boolean),
                rating: normalizeRating(p.rating),
                score: p.score ?? 0,
                fileUrl,
                previewUrl: p.preview_file_url || p.large_file_url || fileUrl,
                width: p.image_width ?? null,
                height: p.image_height ?? null,
                md5: p.md5 || null,
                ext: p.file_ext || extFromUrl(fileUrl),
                postedAt: p.created_at || null,
                sourcePageUrl: `${baseUrl}/posts/${p.id}`
            };
        });
    }

    async function testConnection(credentials = {}) {
        if (!credentials.apiKey || !credentials.username) {
            const posts = await search({ tags: '', page: 1, limit: 1, credentials });
            return { ok: true, authenticated: false, sample: posts.length };
        }
        const baseUrl = (credentials.baseUrl || defaultBaseUrl).replace(/\/$/, '');
        const params = new URLSearchParams({ api_key: credentials.apiKey, login: credentials.username });
        await httpGetJson(`${baseUrl}/profile.json?${params.toString()}`, {
            headers: { 'User-Agent': 'nyarr/0.1' }
        });
        return { ok: true, authenticated: true };
    }

    return { search, testConnection };
}

// e621-family adapter: sites exposing /posts.json with an e621-shaped post
// (file.url/md5/ext, preview.url, tags as object-of-lists, score.total).
function e621FamilyAdapter({ label, defaultBaseUrl }) {
    async function search({ tags, page = 1, limit = 100, credentials = {} }) {
        const baseUrl = (credentials.baseUrl || defaultBaseUrl).replace(/\/$/, '');
        const params = new URLSearchParams({ tags: tags || '', page: String(page), limit: String(limit) });
        const headers = { 'User-Agent': credentials.userAgent || 'nyarr/0.1 (by anonymous)' };
        if (credentials.username && credentials.apiKey) {
            headers.Authorization = 'Basic ' + Buffer.from(`${credentials.username}:${credentials.apiKey}`).toString('base64');
        }
        const rawPosts = await httpGetJson(`${baseUrl}/posts.json?${params.toString()}`, { headers });

        return (rawPosts.posts || []).map((p) => {
            const allTags = Object.values(p.tags || {}).flat();
            return {
                sourcePostId: String(p.id),
                tags: allTags,
                rating: normalizeRating(p.rating),
                score: p.score?.total ?? 0,
                fileUrl: p.file?.url || null,
                previewUrl: p.preview?.url || p.sample?.url || p.file?.url || null,
                width: p.file?.width ?? null,
                height: p.file?.height ?? null,
                md5: p.file?.md5 || null,
                ext: p.file?.ext || null,
                postedAt: p.created_at || null,
                sourcePageUrl: `${baseUrl}/posts/${p.id}`
            };
        });
    }

    async function testConnection(credentials = {}) {
        if (!credentials.username || !credentials.apiKey) {
            const posts = await search({ tags: '', page: 1, limit: 1, credentials });
            return { ok: true, authenticated: false, sample: posts.length };
        }
        const baseUrl = (credentials.baseUrl || defaultBaseUrl).replace(/\/$/, '');
        const headers = {
            'User-Agent': credentials.userAgent || 'nyarr/0.1 (by anonymous)',
            Authorization: 'Basic ' + Buffer.from(`${credentials.username}:${credentials.apiKey}`).toString('base64')
        };
        await httpGetJson(`${baseUrl}/favorites.json?limit=1`, { headers });
        return { ok: true, authenticated: true };
    }

    return { search, testConnection };
}

module.exports = {
    gelbooruFamilyAdapter,
    danbooruFamilyAdapter,
    e621FamilyAdapter,
    ...require('./base')
};
