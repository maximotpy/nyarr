# nyarr

A *arr-style manager for booru image boards. You define **tag sets** (a
saved search on a specific booru), it polls on a schedule, indexes new
matching posts, and optionally auto-downloads them to disk — the same
mental model as Sonarr/Radarr, but the "series" is a tag search instead
of a TV show.

Supports **Danbooru**, **Gelbooru**, **e621**, and **Rule34**.

## Documentation

- [User guide](docs/USAGE.md) — installation, configuration, and day to
  day use.
- [API reference](docs/API.md) — every HTTP endpoint, request and
  response shapes, authentication.

## Quick start

```bash
npm install
npm start
```

Then open **http://localhost:7373**.

No database server or build step needed — app state (tag sets, settings,
activity log) lives in a local `data/db.json` file, and downloaded files
land under a configurable library root (`downloads/` by default).

## Storage locations

Two separate things can be relocated, for two separate reasons:

- **The library root** (where downloaded/imported files live) — set this
  from **Settings → General → Library location** in the UI. Point it at
  a different drive, a NAS mount, wherever you actually want your images
  to live. Takes effect immediately, no restart needed.
- **The app's own data directory** (`data/db.json` — tag sets, indexer
  credentials, activity log) — set this via the `NYARR_DATA_DIR`
  environment variable *before starting the app*:

  ```bash
  NYARR_DATA_DIR=/mnt/appdata/nyarr npm start
  ```

  This one can't be an in-app setting, since the app needs to know where
  that file is before it can read any settings out of it.

## Settings

The Settings page has two tabs:

**Indexers** — per-booru credentials (see below).

**General**:
- **Instance** — display name (shown as the page title/sidebar wordmark)
  and port. Changing the port needs a restart to take effect.
- **Library location** — the root folder setting above, with a built-in
  folder browser (reads directories on the machine running the server).
- **Authentication** — off by default. Switch to "Basic" to require a
  username/password (your browser's native login prompt) for the whole
  app, UI included.
- **API key** — auto-generated on first run, required on every `/api/*`
  request. The bundled web UI sends it automatically; you'd only need to
  copy it if you're scripting against the API directly. Regenerate it if
  you think it's leaked.
- **Backup & restore** — download the entire dataset as one JSON file, or
  restore from a previously downloaded one (this fully replaces current
  data, so it'll ask for confirmation).
- **Library import** — already have a folder of booru images from
  somewhere else? Point this at it and nyarr will register every image
  it finds as a library entry without re-downloading anything. Files
  that happen to live outside the current library root are referenced in
  place (never moved or copied); files under the library root are
  adopted the same way a normal download would be. Re-running an import
  on the same folder skips files it's already seen.

## Setting up API keys (indexer credentials)

- **Danbooru** — Username + API key, from your account's *API Key* page.
- **Gelbooru** — User ID + API key, from `My Account → Options → API Access Credentials`.
- **e621** — Username + API key (from `Account → API Access`), plus a
  descriptive **User agent** (e.g. `myapp/1.0 (by yourusername)`) — e621
  rejects requests without one.
- **Rule34** — User ID + API key, from your account API settings. Note: as
  of Aug 2025, Rule34 requires **both** on every API request (not just for
  higher rate limits like it used to) — searches will fail without them.
  "Test connection" confirms both are present and that a request with them
  succeeds; it can't fully confirm a wrong-but-present key/user-id pair
  would be rejected, since that isn't clearly documented.

Danbooru/Gelbooru/e621 still work without an API key for public/safe
content, but rate limits are much stricter. Use "Test connection" after
saving to confirm what actually got verified — see the comments in each
adapter's `testConnection()` for exactly what is and isn't checked.

Credentials, the password hash, and the API key are all stored in
`data/db.json` (or wherever `NYARR_DATA_DIR` points). Passwords are
salted+hashed (scrypt), never stored in plaintext; booru API credentials
*are* stored in plaintext there, same as Sonarr/Radarr store indexer
credentials in `config.xml` — fine for local self-hosting, just don't
commit that file or expose it beyond localhost without also turning on
authentication.

## How it works

1. **Tag Sets** (`/api/tagsets`) — a saved search: source, tag query
   (booru syntax, e.g. `cat blue_eyes -monochrome`), a rating filter
   (safe / safe+questionable / all), a minimum score, a check interval,
   and whether to auto-download matches.
2. **Scheduler** (`src/scheduler.js`) — ticks every minute; any enabled
   tag set past its interval gets re-queried. The first run for a new
   tag set backfills a few pages of history; later runs just check for
   anything new.
3. **Dedup** — posts are deduped by `(source, post id)` and by file MD5,
   so the same image showing up under two IDs (or reposted across
   boorus) won't download twice. Library imports are deduped by resolved
   file path.
4. **Download queue** (`src/downloader.js`) — a simple sequential queue
   that fetches the full-resolution file and writes it under the
   configured library root, at `<root>/<source>/<postId>.<ext>`.
5. **Library** — browse/filter everything that's been indexed, with
   per-post manual download/delete. Files are served by post ID
   (`/library-files/:id`) rather than by raw path, so importing a folder
   from anywhere on disk doesn't turn into a path-traversal hole.
6. **Auth** (`src/auth.js`, wired up in `server.js`) — an optional Basic
   Auth gate in front of everything, plus an API key required on every
   `/api/*` call regardless of whether Basic Auth is on.

## Project layout

```
server.js                 Express entrypoint, auth middleware, templated index
src/
  db.js                   JSON-file datastore (NYARR_DATA_DIR-aware)
  auth.js                 Password hashing + timing-safe comparisons
  scheduler.js             Polling loop + ingest logic
  downloader.js            Download queue processor (library-root-aware)
  indexers/
    base.js                 Shared helpers (rating normalization, http)
    danbooru.js / gelbooru.js / e621.js / rule34.js
    index.js                 Registry
  routes/
    tagsets.js, library.js, settings.js, general.js, files.js, misc.js
public/                   Frontend (vanilla JS, no build step)
```

## Extending it

- **Add another booru**: drop a new file in `src/indexers/` implementing
  `search({ tags, page, limit, credentials })` returning the normalized
  post shape documented at the top of `src/indexers/base.js`, then
  register it in `src/indexers/index.js` and `public/app.js`'s `SOURCES`
  list.
- **Swap storage**: everything reads/writes through `src/db.js` — the
  rest of the app doesn't care whether that's backed by JSON, SQLite, or
  Postgres.
- **Docker**: there's no Dockerfile yet, but the app is a single Node
  process with no native dependencies, so a minimal `node:22-slim` image
  running `npm ci && npm start` with `NYARR_DATA_DIR` and the library
  root mounted as volumes will work as-is.

## Notes / limitations of this prototype

- Sequential (one-at-a-time) downloads — fine for a personal instance,
  but you'll want a concurrency limit if you're pulling a lot of volume.
- Basic Auth is intentionally simple (one username/password, browser's
  native prompt, no sessions/cookies/logout button). Fine for a
  self-hosted personal instance behind your own network; if you need
  more than that, put a proper auth proxy in front instead.
- The directory browser (`GET /api/system/browse`) lists folders on
  whatever machine is running the server — if you're accessing nyarr
  remotely, "Browse…" shows you the *server's* filesystem, not your
  local one.
- Tag aliasing/implications (e.g. a booru auto-expanding a tag to its
  synonyms) is left to each booru's own search — not replicated locally.
