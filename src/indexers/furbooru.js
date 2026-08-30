const { e621FamilyAdapter } = require('./adapters');

const id = 'furbooru';
const label = 'Furbooru';
const adapter = e621FamilyAdapter({ label, defaultBaseUrl: 'https://furbooru.com' });

module.exports = { id, label, search: adapter.search, testConnection: adapter.testConnection };
