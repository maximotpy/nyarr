const { normalizeRating, httpGetJson, extFromUrl } = require('./base');

const id = 'gelbooru';
const label = 'Gelbooru';

async function search({ tags, page = 1, limit = 100, credentials = {} }) {
  const baseUrl = (credentials.baseUrl || 'https://gelbooru.com').replace(/\/$/, '');
  // Gelbooru's dapi is zero-indexed per-page (pid), unlike our 1-indexed `page`.
  const pid = Math.max(0, page - 1);
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

  // Gelbooru wraps results as { post: [...] }, but can return a bare array too.
  const posts = Array.isArray(raw) ? raw : (raw.post || []);

  return posts.map((p) => {
    const fileUrl = p.file_url || null;
    return {
      sourcePostId: String(p.id),
      tags: (p.tags || '').split(' ').filter(Boolean),
      rating: normalizeRating(p.rating),
      score: p.score ?? 0,
      fileUrl,
      previewUrl: p.preview_url || p.sample_url || fileUrl,
      width: p.width ?? null,
      height: p.height ?? null,
      md5: p.md5 || null,
      ext: extFromUrl(fileUrl) || extFromUrl(p.image),
      postedAt: p.created_at || null,
      sourcePageUrl: `${baseUrl}/index.php?page=post&s=view&id=${p.id}`
    };
  });
}

async function testConnection(credentials = {}) {
  // Unlike Danbooru/e621/Rule34, Gelbooru's dapi actually rejects a
  // mismatched api_key/user_id pair on a normal search request, so this
  // plain search doubles as a real credential check.
  const posts = await search({ tags: '', page: 1, limit: 1, credentials });
  const authenticated = Boolean(credentials.apiKey && credentials.userId) || null;
  return { ok: true, authenticated, sample: posts.length };
}

module.exports = { id, label, search, testConnection };
