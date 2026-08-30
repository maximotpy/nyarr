# nyarr

A *arr-style manager for booru image boards. You define **tag sets** (a
saved search on a specific booru), it polls on a schedule, indexes new
matching posts, and optionally auto-downloads them to disk. The mental
model is the same as Sonarr/Radarr, but the "series" is a tag search
instead of a TV show.

Supports **Danbooru**, **Gelbooru**, **e621**, and **Rule34**.

## Documentation

- [User guide](docs/USAGE.md) — installation, configuration, and day to
  day use.
- [API reference](docs/API.md) — every HTTP endpoint, request and
  response shapes, authentication.

## Quick start

Requires Node.js 18 or newer (the app uses the built-in `fetch`).

```bash
npm install
npm start
```

Then open **http://localhost:7373**.

No database server or build step needed. App state (tag sets, settings,
activity log) lives in a local `data/db.json` file, and downloaded files
land under a configurable library root (`downloads/` by default).

Environment variables:

| Variable | Purpose |
| --- | --- |
| `PORT` | Overrides the configured port for this run |
| `NYARR_DATA_DIR` | Relocates the data directory (the folder holding `db.json`) |

Example:

```bash
NYARR_DATA_DIR=/mnt/appdata/nyarr npm start
```

The data directory has to be set through the environment rather than a
setting inside the app, because the app needs to know where `db.json` is
before it can read any settings out of it.

## How it works

1. **Tag sets** - a saved search: source, tag query (booru syntax, e.g.
   `cat blue_eyes -monochrome`), a rating filter (safe / safe+questionable
   / all), a minimum score, a check interval, and whether to
   auto-download matches.
2. **Scheduler** (`src/scheduler.js`) - ticks every minute; any enabled
   tag set past its interval gets re-queried. The first run for a new tag
   set backfills 3 pages of history (100 posts per page); later runs
   check 1 page for anything new.
3. **Dedup** - posts are deduped by `(source, post id)` and by file MD5,
   so the same image showing up under two IDs (or reposted across boorus)
   won't be indexed twice.
4. **Download queue** (`src/downloader.js`) - a simple sequential queue
   that fetches the full-resolution file and writes it under the
   configured library root, at `<root>/<source>/<postId>.<ext>`.
5. **Library** - browse and filter everything that has been indexed, with
   per-post manual download and delete. Files are served by post ID
   (`/library-files/:id`) rather than by raw path, so importing a folder
   from anywhere on disk doesn't turn into a path-traversal hole.
6. **Auth** (`src/auth.js`, wired up in `server.js`) - an optional Basic
   Auth gate in front of everything, plus an API key required on every
   `/api/*` call regardless of whether Basic Auth is on.

## The web UI

A single-page app (vanilla JS, no build step) with five pages:

- **Dashboard** - counters for tag sets and posts by status, plus the
  recent activity feed.
- **Tag Sets** - create, edit, enable/disable, delete, and run any tag
  set immediately with "search now".
- **Library** - every indexed post, filterable by status, source, tag
  set, or tag text. Download or delete posts individually.
- **Activity** - the last 100 log entries (info, success, warn, error).
- **Settings** - indexer credentials and general settings.

## Settings

### General

- **Instance name** - shown as the page title and sidebar wordmark.
- **Port** - changing it needs a restart to take effect.
- **Library location** - where downloaded files live, with a built-in
  folder browser. Note the browser lists folders on the machine running
  the server, not your local machine if you are accessing nyarr
  remotely. Takes effect immediately, no restart needed. Download records
  store paths relative to the root, so moving the root later doesn't
  orphan them.
- **Authentication** - off by default. Switch to "Basic" to require a
  username and password (your browser's native login prompt) for the
  whole app, UI included. The first enable requires setting a password;
  passwords are salted and hashed with scrypt, never stored in
  plaintext.
- **API key** - auto-generated on first run, required on every `/api/*`
  request. The bundled web UI gets it injected automatically; you only
  need to copy it if you're scripting against the API directly.
  Regenerate it if you think it has leaked.
- **Backup & restore** - download the entire dataset as one JSON file, or
  restore from a previously downloaded one. Restoring fully replaces
  current data, so it asks for confirmation first.

### Indexers

Per-booru credentials, verified with a "Test connection" button:

- **Danbooru** - Username + API key, from your account's API Key page.
- **Gelbooru** - User ID + API key, from My Account, Options, API Access
  Credentials.
- **e621** - Username + API key (from Account, API Access), plus a
  descriptive **User agent** (e.g. `myapp/1.0 (by yourusername)`). e621
  rejects requests without one.
- **Rule34** - User ID + API key, from your account API settings. As of
  Aug 2025, Rule34 requires **both** on every API request (not just for
  higher rate limits like it used to), so searches fail without them.

Danbooru, Gelbooru, and e621 still work without an API key for
public/safe content, but rate limits are much stricter. "Test connection"
confirms the credentials are present and that a request with them
succeeds; it can't always detect a wrong-but-present key, so if tests
pass but searches return nothing, double-check the key on the site
itself.

Credentials, the password hash, and the API key are all stored in
`data/db.json` (or wherever `NYARR_DATA_DIR` points). Booru API
credentials are stored in plaintext there, same as Sonarr/Radarr store
indexer credentials in `config.xml`. Fine for local self-hosting, just
don't commit that file or expose it beyond localhost without also turning
on authentication.

## Library import

Already have a folder of booru images from somewhere else? Point the
import (Library page) at it and nyarr registers every image it finds as
a library entry without re-downloading anything.

- Files under the current library root are adopted exactly like a normal
  download (stored as a relative path).
- Files outside the library root are referenced in place as absolute
  paths. They are never moved or copied, and deleting such an entry from
  the library never deletes the source file.
- Re-running an import on the same folder skips files it has already
  seen.
- The scan walks up to 8 levels deep and recognizes jpg, jpeg, png, gif,
  webp, bmp, mp4, webm, apng, and avif files.

## Storage layout

Two separate locations can be configured:

- **Library root** (downloaded files): set at runtime from Settings.
  Default is `downloads/` next to the app. Files land at
  `<root>/<source>/<postId>.<ext>`.
- **Data directory** (`db.json` with tag sets, posts, indexer
  credentials, activity log): set via `NYARR_DATA_DIR` before starting.

## API

Every `/api/*` request needs the API key as an `X-Api-Key` header (or
Basic auth credentials when authentication is enabled). Quick examples:

```bash
# List tag sets
curl -H "X-Api-Key: YOURKEY" http://localhost:7373/api/tagsets

# Create a tag set
curl -X POST -H "X-Api-Key: YOURKEY" -H "Content-Type: application/json" \
  -d '{"name":"Cats","source":"danbooru","tags":"cat blue_eyes","autoDownload":true}' \
  http://localhost:7373/api/tagsets

# Trigger a search now
curl -X POST -H "X-Api-Key: YOURKEY" http://localhost:7373/api/tagsets/1/search-now
```

Endpoint overview:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/tagsets` | List tag sets (with post counts) |
| POST | `/api/tagsets` | Create a tag set |
| PUT | `/api/tagsets/:id` | Update a tag set |
| DELETE | `/api/tagsets/:id` | Delete a tag set (posts are kept) |
| POST | `/api/tagsets/:id/search-now` | Run the search immediately |
| GET | `/api/library` | List/filter posts (status, source, tagSetId, q, page, pageSize) |
| POST | `/api/library/:id/download` | Queue a post for download |
| DELETE | `/api/library/:id` | Delete a post (and its file, unless imported) |
| POST | `/api/library/import` | Register an existing folder of images |
| GET | `/api/indexers` | List supported indexers |
| GET | `/api/settings` | Get all indexer credentials |
| PUT | `/api/settings/:indexerId` | Update one indexer's credentials |
| POST | `/api/settings/:indexerId/test` | Test an indexer's connection |
| GET | `/api/general` | Get general settings |
| PUT | `/api/general` | Update general settings |
| POST | `/api/general/regenerate-api-key` | Issue a new API key |
| GET | `/api/system/browse?path=...` | Directory listing for the folder picker |
| GET | `/api/system/backup` | Download the whole dataset as JSON |
| POST | `/api/system/restore` | Replace all data from a backup |
| GET | `/api/activity` | Last 100 activity entries |
| GET | `/api/stats` | Dashboard counters |
| GET | `/library-files/:id` | Serve a post's file (no API key needed) |

## Project layout

```
server.js                 Express entrypoint, auth middleware, templated index
src/
  db.js                   JSON-file datastore (NYARR_DATA_DIR-aware)
  auth.js                 Password hashing + timing-safe comparisons
  scheduler.js            Polling loop + ingest logic
  downloader.js           Download queue processor (library-root-aware)
  indexers/
    base.js               Shared helpers (rating normalization, http)
    danbooru.js / gelbooru.js / e621.js / rule34.js
    index.js              Registry
  routes/
    tagsets.js, library.js, settings.js, general.js, files.js, misc.js
public/                   Frontend (vanilla JS, no build step)
data/                     db.json lives here (see NYARR_DATA_DIR)
downloads/                Default library root
```

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

## Notes / limitations

- Sequential (one-at-a-time) downloads. Fine for a personal instance, but
  you'll want a concurrency limit if you're pulling a lot of volume.
- Basic Auth is intentionally simple: one username and password, the
  browser's native prompt, no sessions or logout button. Fine for a
  self-hosted personal instance behind your own network; if you need more
  than that, put a proper auth proxy in front instead.
- The directory browser (`GET /api/system/browse`) lists folders on
  whatever machine is running the server. If you're accessing nyarr
  remotely, "Browse" shows the server's filesystem, not your local one.
- Tag aliasing/implications (a booru auto-expanding a tag to its
  synonyms) is left to each booru's own search, not replicated locally.
- Backup files contain the API key and booru credentials in plaintext, so
  treat them as secrets.
