const { gelbooruFamilyAdapter } = require('./adapters');

const id = 'tbib';
const label = 'TBIB';
const adapter = gelbooruFamilyAdapter({ label, defaultBaseUrl: 'https://tbib.org' });

module.exports = { id, label, search: adapter.search, testConnection: adapter.testConnection };
