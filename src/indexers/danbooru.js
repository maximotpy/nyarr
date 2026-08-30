const { danbooruFamilyAdapter } = require('./adapters');

const id = 'danbooru';
const label = 'Danbooru';

const adapter = danbooruFamilyAdapter({ label, defaultBaseUrl: 'https://danbooru.donmai.us' });

module.exports = { id, label, search: adapter.search, testConnection: adapter.testConnection };
