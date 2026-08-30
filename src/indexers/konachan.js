const { danbooruFamilyAdapter } = require('./adapters');

const id = 'konachan';
const label = 'Konachan';
const adapter = danbooruFamilyAdapter({ label, defaultBaseUrl: 'https://konachan.com' });

module.exports = { id, label, search: adapter.search, testConnection: adapter.testConnection };
