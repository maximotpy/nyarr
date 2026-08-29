const { gelbooruFamilyAdapter } = require('./adapters');

const id = 'sankaku';
const label = 'Sankaku Complex';
const adapter = gelbooruFamilyAdapter({ label, defaultBaseUrl: 'https://idol.sankakucomplex.com' });

module.exports = { id, label, search: adapter.search, testConnection: adapter.testConnection };
