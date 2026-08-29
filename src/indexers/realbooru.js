const { gelbooruFamilyAdapter } = require('./adapters');

const id = 'realbooru';
const label = 'Realbooru';
const adapter = gelbooruFamilyAdapter({ label, defaultBaseUrl: 'https://realbooru.com' });

module.exports = { id, label, search: adapter.search, testConnection: adapter.testConnection };
