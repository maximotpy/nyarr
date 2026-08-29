const { normalizeRating, httpGetJson, extFromUrl } = require('./base');

const id = 'danbooru';
const label = 'Danbooru';

async function search({ tags, page = 1, limit = 100, credentials = {} }) {
  const baseUrl = (credentials.baseUrl || 'https://danbooru.donmai.us').replace(/\/$/, '');
  const params = new URLSearchParams({
    tags: tags || '',
    page: String(page),
    limit: String(limit)
  });
  if (credentials.apiKey) params.set('api_key', credentials.apiKey);
  if (credentials.username) params.set('login', credentials.username);

  const url = `${baseUrl}/posts.json?${params.toString()}`;
  const raw = await httpGetJson(url, {
    headers: { 'User-Agent': 'nyarr/0.1' }
  });

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
  const baseUrl = (credentials.baseUrl || 'https://danbooru.donmai.us').replace(/\/$/, '');

  // With no credentials there's nothing to verify auth-wise — just confirm
  // the API is reachable anonymously (same as before).
  if (!credentials.apiKey || !credentials.username) {
    const posts = await search({ tags: '', page: 1, limit: 1, credentials });
    return { ok: true, authenticated: false, sample: posts.length };
  }

  // /profile.json only returns data when login+api_key resolve to a real,
  // matching account — it 401s on a bad key, unlike posts.json which serves
  // public results regardless of whether credentials are valid.
  const params = new URLSearchParams({ api_key: credentials.apiKey, login: credentials.username });
  await httpGetJson(`${baseUrl}/profile.json?${params.toString()}`, {
    headers: { 'User-Agent': 'nyarr/0.1' }
  });
  return { ok: true, authenticated: true };
}

module.exports = { id, label, search, testConnection };
