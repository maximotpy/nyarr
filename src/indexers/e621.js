const { normalizeRating, httpGetJson } = require('./base');

const id = 'e621';
const label = 'e621';

async function search({ tags, page = 1, limit = 100, credentials = {} }) {
  const baseUrl = (credentials.baseUrl || 'https://e621.net').replace(/\/$/, '');
  const params = new URLSearchParams({
    tags: tags || '',
    page: String(page),
    limit: String(limit)
  });

  const headers = {
    // e621 requires a descriptive User-Agent identifying the app + a contact,
    // or it will reject requests with a 403.
    'User-Agent': credentials.userAgent || 'nyarr/0.1 (by anonymous)'
  };
  if (credentials.username && credentials.apiKey) {
    headers.Authorization = 'Basic ' + Buffer.from(`${credentials.username}:${credentials.apiKey}`).toString('base64');
  }

  const url = `${baseUrl}/posts.json?${params.toString()}`;
  const raw = await httpGetJson(url, { headers });
  const posts = raw.posts || [];

  return posts.map((p) => {
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
  const baseUrl = (credentials.baseUrl || 'https://e621.net').replace(/\/$/, '');
  const headers = { 'User-Agent': credentials.userAgent || 'nyarr/0.1 (by anonymous)' };

  if (!credentials.username || !credentials.apiKey) {
    const posts = await search({ tags: '', page: 1, limit: 1, credentials });
    return { ok: true, authenticated: false, sample: posts.length };
  }

  // posts.json ignores a bad Basic-auth header and just serves public
  // results, so it can't tell a good key from a bad one. /favorites.json
  // is scoped to the authenticated user and 401s if the credentials don't
  // resolve to a real account.
  headers.Authorization = 'Basic ' + Buffer.from(`${credentials.username}:${credentials.apiKey}`).toString('base64');
  await httpGetJson(`${baseUrl}/favorites.json?limit=1`, { headers });
  return { ok: true, authenticated: true };
}

module.exports = { id, label, search, testConnection };
