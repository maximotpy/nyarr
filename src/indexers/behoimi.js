const { gelbooruFamilyAdapter } = require('./adapters');

const id = 'behoimi';
const label = 'Behoimi (3dBooru)';
const requiresCredentials = true;
const adapter = gelbooruFamilyAdapter({ label, defaultBaseUrl: 'https://behoimi.org', requiresCredentials: true });

module.exports = { id, label, requiresCredentials, search: adapter.search, testConnection: adapter.testConnection };
