const { normalizeRating, httpGetJson, extFromUrl } = require('./base');

const id = 'rule34';
const label = 'Rule34';

async function search({ tags, page = 1, limit = 100, credentials = {} }) {
  const baseUrl = (credentials.baseUrl || 'https://api.rule34.xxx').replace(/\/$/, '');
  const pid = Math.max(0, page - 1); // zero-indexed, same dapi lineage as Gelbooru
  const params = new URLSearchParams({
    page: 'dapi',
    s: 'post',
    q: 'index',
    json: '1',
    tags: tags || '',
    limit: String(limit),
    pid: String(pid)
  });
  if (credentials.apiKey) params.set('api_key', credentials.apiKey);
  if (credentials.userId) params.set('user_id', credentials.userId);

  const url = `${baseUrl}/index.php?${params.toString()}`;
  const raw = await httpGetJson(url, {
    headers: { 'User-Agent': 'nyarr/0.1' }
  });

  const posts = Array.isArray(raw) ? raw : (raw.post || []);

  return posts.map((p) => {
    const fileUrl = p.file_url || null;
    return {
      sourcePostId: String(p.id),
      tags: (p.tags || '').split(' ').filter(Boolean),
      // Rule34's dapi doesn't return a rating field consistently; default to explicit
      // since the source is a dedicated adult board.
      rating: normalizeRating(p.rating || 'explicit'),
      score: p.score ?? 0,
      fileUrl,
      previewUrl: p.preview_url || p.sample_url || fileUrl,
      width: p.width ?? null,
      height: p.height ?? null,
      md5: p.hash || p.md5 || null,
      ext: extFromUrl(fileUrl),
      postedAt: p.change ? new Date(Number(p.change) * 1000).toISOString() : null,
      sourcePageUrl: `${baseUrl.replace('api.', '')}/index.php?page=post&s=view&id=${p.id}`
    };
  });
}

async function testConnection(credentials = {}) {
  // As of Aug 19 2025, api.rule34.xxx requires api_key + user_id on every
  // request and rejects requests missing either with an explicit
  // "AuthRequired" error — so, unlike before, a request with no credentials
  // is now a reliable negative signal.
  if (!credentials.apiKey || !credentials.userId) {
    return {
      ok: false,
      authenticated: false,
      error: "Rule34 requires both an API key and a user ID for every request (since Aug 2025) — enter both to test."
    };
  }

  const posts = await search({ tags: '', page: 1, limit: 1, credentials });
  // We've confirmed missing credentials are rejected. We have not been able
  // to confirm whether a syntactically-valid but mismatched key/user-id
  // pair is also rejected, or silently accepted — so don't overclaim a
  // guarantee here, just report what we actually observed.
  return {
    ok: true,
    authenticated: true,
    sample: posts.length,
    note: "Request succeeded with these credentials. Rule34 doesn't clearly document whether a wrong-but-present key/user-id pair is rejected outright, so this confirms the request went through, not that the pair is definitely correct."
  };
}

module.exports = { id, label, search, testConnection };
