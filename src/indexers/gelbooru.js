const { gelbooruFamilyAdapter } = require('./adapters');

const id = 'gelbooru';
const label = 'Gelbooru';
const requiresCredentials = true;

const adapter = gelbooruFamilyAdapter({ label, defaultBaseUrl: 'https://gelbooru.com', requiresCredentials });

module.exports = { id, label, requiresCredentials, search: adapter.search, testConnection: adapter.testConnection };
