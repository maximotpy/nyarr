# nyarr

if you don't like ai, please do not use this

A vibecoded *arr-style manager for booru image boards. You define **tag sets** (a
saved search on a specific booru), it polls on a schedule, indexes new
matching posts, and optionally auto-downloads them to disk.

Supports **Danbooru**, **Gelbooru**, **e621**, and **Rule34** and a few more sites.

## Documentation

- [User guide](docs/USAGE.md) - installation, configuration, and day to
  day use.
- [API reference](docs/API.md) - every HTTP endpoint, request and
  response shapes, authentication.

## Quick start

```bash
npm install
npm start
```

Then open **http://localhost:7373**.


## Extending it

- **Add another booru**: drop a new file in `src/indexers/` implementing
  `search({ tags, page, limit, credentials })` returning the normalized
  post shape documented at the top of `src/indexers/base.js`, then
  register it in `src/indexers/index.js` and `public/app.js`'s `SOURCES`
  list.
- **Swap storage**: everything reads/writes through `src/db.js`. The rest
  of the app doesn't care whether that's backed by JSON, SQLite, or
  Postgres.
- **Docker**: there's no Dockerfile yet, but the app is a single Node
  process with no native dependencies, so a minimal `node:22-slim` image
  running `npm ci && npm start` with `NYARR_DATA_DIR` and the library
  root mounted as volumes will work as-is.
