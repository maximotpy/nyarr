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

module.exports = { REGISTRY, list, get };
