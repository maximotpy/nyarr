const { e621FamilyAdapter } = require('./adapters');

const id = 'e621';
const label = 'e621';

const adapter = e621FamilyAdapter({ label, defaultBaseUrl: 'https://e621.net' });

module.exports = { id, label, search: adapter.search, testConnection: adapter.testConnection };
