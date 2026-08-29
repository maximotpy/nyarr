const { gelbooruFamilyAdapter } = require('./adapters');

const id = 'behoimi';
const label = 'Behoimi (3dBooru)';
const adapter = gelbooruFamilyAdapter({ label, defaultBaseUrl: 'https://behoimi.org' });

module.exports = { id, label, search: adapter.search, testConnection: adapter.testConnection };
