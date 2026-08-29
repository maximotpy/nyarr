const danbooru = require('./danbooru');
const gelbooru = require('./gelbooru');
const e621 = require('./e621');
const rule34 = require('./rule34');

const REGISTRY = { danbooru, gelbooru, e621, rule34 };

function list() {
  return Object.values(REGISTRY).map((i) => ({ id: i.id, label: i.label }));
}

function get(id) {
  const indexer = REGISTRY[id];
  if (!indexer) throw new Error(`Unknown indexer: ${id}`);
  return indexer;
}

module.exports = { REGISTRY, list, get };
