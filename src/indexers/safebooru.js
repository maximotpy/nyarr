const { gelbooruFamilyAdapter } = require('./adapters');

const id = 'safebooru';
const label = 'Safebooru';
const adapter = gelbooruFamilyAdapter({ label, defaultBaseUrl: 'https://safebooru.org' });

module.exports = { id, label, search: adapter.search, testConnection: adapter.testConnection };
