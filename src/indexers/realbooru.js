const { gelbooruFamilyAdapter } = require('./adapters');

const id = 'realbooru';
const label = 'Realbooru';
const requiresCredentials = true;
const adapter = gelbooruFamilyAdapter({ label, defaultBaseUrl: 'https://realbooru.com', requiresCredentials: true });

module.exports = { id, label, requiresCredentials, search: adapter.search, testConnection: adapter.testConnection };
