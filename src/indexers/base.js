// Shared helpers used by every booru adapter. Each adapter normalizes its
// API's response into this common shape:
//
// {
//   sourcePostId: string,
//   tags: string[],
//   rating: 'safe' | 'questionable' | 'explicit',
//   score: number,
//   fileUrl: string | null,
//   previewUrl: string | null,
//   width: number | null,
//   height: number | null,
//   md5: string | null,
//   ext: string | null,
//   postedAt: string | null,
//   sourcePageUrl: string
// }

const RATING_ORDER = { safe: 0, questionable: 1, explicit: 2 };

// Different boorus spell ratings differently. Normalize to safe/questionable/explicit.
function normalizeRating(raw) {
  if (!raw) return 'questionable';
  const r = String(raw).toLowerCase();
  if (['s', 'safe', 'g', 'general'].includes(r)) return 'safe';
  if (['q', 'questionable', 'sensitive'].includes(r)) return 'questionable';
  if (['e', 'explicit'].includes(r)) return 'explicit';
  return 'questionable';
}

function ratingAllowed(rating, filter) {
  // filter: 'safe' | 'safe_questionable' | 'all'
  if (filter === 'all') return true;
  if (filter === 'safe_questionable') return RATING_ORDER[rating] <= RATING_ORDER.questionable;
  return rating === 'safe';
}

async function httpGetJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status} ${res.statusText} for ${url}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function extFromUrl(url) {
  if (!url) return null;
  const match = url.split('?')[0].match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : null;
}

module.exports = { normalizeRating, ratingAllowed, httpGetJson, extFromUrl, RATING_ORDER };
