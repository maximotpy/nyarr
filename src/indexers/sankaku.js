const { gelbooruFamilyAdapter } = require('./adapters');

const id = 'sankaku';
const label = 'Sankaku Complex';
const requiresCredentials = true;
const adapter = gelbooruFamilyAdapter({ label, defaultBaseUrl: 'https://idol.sankakucomplex.com', requiresCredentials: true });

module.exports = { id, label, requiresCredentials, search: adapter.search, testConnection: adapter.testConnection };
