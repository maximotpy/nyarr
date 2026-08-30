const { gelbooruFamilyAdapter } = require('./adapters');

const id = 'rule34';
const label = 'Rule34';
const requiresCredentials = true;

const adapter = gelbooruFamilyAdapter({ label, defaultBaseUrl: 'https://api.rule34.xxx', requiresCredentials });

// Rule34's dapi doesn't return a rating field consistently; the adapter
// defaults to explicit, which is correct for this dedicated adult board.
async function testConnection(credentials = {}) {
  // As of Aug 19 2025, api.rule34.xxx requires api_key + user_id on every
  // request and rejects requests missing either with an explicit
  // "AuthRequired" error, so, unlike before, a request with no credentials
  // is now a reliable negative signal.
  if (!credentials.apiKey || !credentials.userId) {
    return {
      ok: false,
      authenticated: false,
      error: "Rule34 requires both an API key and a user ID for every request (since Aug 2025), enter both to test."
    };
  }

  const posts = await adapter.search({ tags: '', page: 1, limit: 1, credentials });
  // We've confirmed missing credentials are rejected. We have not been able
  // to confirm whether a syntactically-valid but mismatched key/user-id
  // pair is also rejected, or silently accepted, so don't overclaim a
  // guarantee here, just report what we actually observed.
  return {
    ok: true,
    authenticated: true,
    sample: posts.length,
    note: "Request succeeded with these credentials. Rule34 doesn't clearly document whether a wrong-but-present key/user-id pair is rejected outright, so this confirms the request went through, not that the pair is definitely correct."
  };
}

module.exports = { id, label, requiresCredentials, search: adapter.search, testConnection };
