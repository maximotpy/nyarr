const { danbooruFamilyAdapter } = require('./adapters');

const id = 'yandere';
const label = 'Yande.re';
const adapter = danbooruFamilyAdapter({ label, defaultBaseUrl: 'https://yande.re' });

module.exports = { id, label, search: adapter.search, testConnection: adapter.testConnection };
