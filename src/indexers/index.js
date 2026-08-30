const danbooru = require('./danbooru');
const gelbooru = require('./gelbooru');
const e621 = require('./e621');
const rule34 = require('./rule34');
const safebooru = require('./safebooru');
const konachan = require('./konachan');
const yandere = require('./yandere');
const furbooru = require('./furbooru');
const sankaku = require('./sankaku');
const realbooru = require('./realbooru');
const tbib = require('./tbib');
const behoimi = require('./behoimi');

const REGISTRY = {
  danbooru,
  gelbooru,
  e621,
  rule34,
  safebooru,
  konachan,
  yandere,
  furbooru,
  sankaku,
  realbooru,
  tbib,
  behoimi
};

function list() {
  return Object.values(REGISTRY).map((i) => ({
    id: i.id,
    label: i.label,
    requiresCredentials: Boolean(i.requiresCredentials)
  }));
}

function get(id) {
  const indexer = REGISTRY[id];
  if (!indexer) throw new Error(`Unknown indexer: ${id}`);
  return indexer;
}

// Ids of indexers the user has actually added (i.e. entered credentials for)
// in Settings → Indexers. Fields that ship pre-filled by default (baseUrl,
// default user agents) don't count, only real credentials do. Used by
// artist watches so they only hit sources the user opted into, instead of
// blindly querying all 12 boorus and collecting a wall of 401/404 errors.
function configuredIds() {
  const settings = require('../db').data.settings;
  return Object.keys(REGISTRY).filter((id) => {
    const creds = settings[id] || {};
    return Object.keys(creds).some((k) => k !== 'baseUrl' && k !== 'userAgent' && creds[k]);
  });
}

module.exports = { REGISTRY, list, get, configuredIds };
