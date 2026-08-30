# nyarr API reference

Every endpoint lives under the same Express server that serves the web
UI, by default at `http://localhost:7373`.

This document describes the HTTP API in full: authentication, every
route, request bodies, query parameters, and response shapes.

## Contents

1. [Authentication](#authentication)
2. [Conventions](#conventions)
3. [General settings](#general-settings)
4. [Indexer settings](#indexer-settings)
5. [Tag sets](#tag-sets)
6. [Artist watches](#artist-watches)
7. [Library](#library)
8. [Files](#files)
9. [Activity, stats, downloads](#activity-stats-downloads)
10. [System](#system)
11. [Non-API routes](#non-api-routes)
12. [Data model](#data-model)

## Authentication

All `/api/*` requests require an API key, regardless of whether login
authentication is enabled. Send it as a header:

```
X-Api-Key: <your api key>
```

The key is generated on first run and shown in Settings, General. You can
regenerate it with `POST /api/general/regenerate-api-key`.

If authentication is set to Basic, requests may alternatively use HTTP
Basic auth with the username and password created during setup:

```
Authorization: Basic <base64 username:password>
```

Either the API key header or valid Basic auth is enough. The bundled web
UI gets the key injected into the page automatically, so only external
scripts need to send it.

Error responses:

| Status | Meaning |
| --- | --- |
| 401 | Missing or invalid API key, or failed Basic auth |
| 503 | Setup required: authentication is enabled but no account exists yet. Open the web UI to create one |
| 400 | Bad request, the body contains `{ "error": "..." }` |
| 404 | The requested object does not exist |

## Conventions

- All request and response bodies are JSON unless noted otherwise.
- IDs are integers, assigned sequentially.
- Timestamps are ISO 8601 strings in UTC, e.g. `2026-08-29T12:00:00.000Z`.
- Endpoints that accept partial updates ignore fields that are not sent.
- Batch endpoints take `{ "action": "...", "ids": [1, 2, 3] }`.

### curl examples

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

## General settings

### `GET /api/general`

Returns the general settings object. The password hash and salt are never
included.

```json
{
  "instanceName": "nyarr",
  "port": 7373,
  "libraryRoot": "/path/to/downloads",
  "authMethod": "none",
  "username": "",
  "apiKey": "hex string"
}
```

### `PUT /api/general`

Partial update. Fields:

| Field | Type | Notes |
| --- | --- | --- |
| `instanceName` | string | Display name, defaults to `nyarr` if blank |
| `port` | integer | 1 to 65535. Needs a restart to take effect |
| `libraryRoot` | string | Must exist or be creatable and writable, otherwise 400 |
| `authMethod` | string | `none` or `basic` |
| `username` | string | Required when enabling basic auth |
| `password` | string | Sets a new password (salted, scrypt hashed). Required the first time basic auth is enabled |

Example:

```json
{ "libraryRoot": "/mnt/media/booru", "authMethod": "basic", "username": "me", "password": "secret" }
```

### `POST /api/general/regenerate-api-key`

Generates a new API key, invalidating the old one. Returns:

```json
{ "apiKey": "new hex string" }
```

## Indexer settings

### `GET /api/indexers`

Lists all supported indexers:

```json
[
  { "id": "danbooru", "label": "Danbooru", "requiresCredentials": false },
  { "id": "gelbooru", "label": "Gelbooru", "requiresCredentials": true }
]
```

Supported ids: `danbooru`, `gelbooru`, `e621`, `rule34`, `safebooru`,
`konachan`, `yandere`, `furbooru`, `sankaku`, `realbooru`, `tbib`,
`behoimi`.

### `GET /api/settings`

Returns the credential object for every indexer, keyed by id. Example:

```json
{
  "danbooru": { "baseUrl": "https://danbooru.donmai.us", "apiKey": "", "username": "" },
  "e621": { "baseUrl": "https://e621.net", "apiKey": "", "username": "", "userAgent": "nyarr/0.1 (by anonymous)" }
}
```

### `PUT /api/settings/:indexerId`

Merges the body into that indexer's settings. Unknown indexer ids return
404. Typical fields are `apiKey`, `username` or `userId`, `baseUrl`, and
`userAgent` where applicable.

### `POST /api/settings/:indexerId/test`

Runs the indexer's connection test with the stored credentials. Returns
`{ "ok": true, ... }` on success, or status 400 with
`{ "ok": false, "error": "..." }` on failure. The result is also written
to the activity feed.

## Tag sets

A tag set is a saved search pinned to one booru.

### `GET /api/tagsets`

Returns all tag sets with two computed fields added:

```json
[
  {
    "id": 1,
    "name": "Cats",
    "source": "danbooru",
    "tags": "cat blue_eyes",
    "ratingFilter": "safe_questionable",
    "minScore": 0,
    "intervalMinutes": 60,
    "maxPages": null,
    "autoDownload": true,
    "enabled": true,
    "lastChecked": "2026-08-29T10:00:00.000Z",
    "lastError": null,
    "backfillComplete": true,
    "backfillCursor": 1,
    "createdAt": "2026-08-01T09:00:00.000Z",
    "postCount": 42,
    "downloadedCount": 40
  }
]
```

### `POST /api/tagsets`

Creates a tag set. Required fields: `name`, `source`, `tags`. Optional
fields and their defaults:

| Field | Default | Notes |
| --- | --- | --- |
| `ratingFilter` | `safe_questionable` | `safe`, `safe_questionable`, or `all` |
| `minScore` | `0` | Posts below this score are skipped |
| `intervalMinutes` | `60` | Minutes between automatic checks |
| `maxPages` | `null` | `null` = auto backfill then catch up, a number = fixed page budget per run, `0` = walk everything (capped at 100 pages) |
| `autoDownload` | `false` | Queue downloads for new matches |
| `enabled` | `true` | Disabled sets are skipped by the scheduler |

Returns 201 with the created tag set including counts.

### `PUT /api/tagsets/:id`

Partial update of any of the fields above. Returns the updated tag set
with counts, or 404.

### `DELETE /api/tagsets/:id`

Deletes the tag set. Indexed posts and downloaded files are kept. Returns
204.

### `POST /api/tagsets/:id/search-now`

Runs the tag set immediately and waits for the result:

```json
{ "ok": true, "seen": 100, "inserted": 3 }
```

On failure returns 502 with `{ "ok": false, "error": "..." }`.

### `POST /api/tagsets/batch`

Body: `{ "action": "...", "ids": [1, 2] }`. Actions:

| Action | Effect | Response |
| --- | --- | --- |
| `enable` | Sets `enabled: true` on each | `{ "ok": true, "affected": n }` |
| `disable` | Sets `enabled: false` on each | `{ "ok": true, "affected": n }` |
| `search` | Runs search-now on each, fire and forget | `{ "ok": true, "started": n }` |
| `delete` | Removes the tag sets, downloads are kept | `{ "ok": true, "deleted": n }` |

Anything else returns 400.

## Artist watches

An artist watch searches one artist tag on every configured indexer at
once. The endpoints mirror the tag set endpoints exactly.

### `GET /api/artists`

Returns all artist watches with `postCount` and `downloadedCount` added.
Each artist has an `artistTag` field instead of `source` + `tags`, and a
`pageCursors` object tracking the backfill position per source.

### `POST /api/artists`

Creates a watch. Required fields: `name`, `artistTag` (for example
`wlop`). Optional fields are the same as tag sets: `ratingFilter`,
`minScore`, `intervalMinutes`, `maxPages`, `autoDownload`, `enabled`.

### `PUT /api/artists/:id`

Partial update. Returns the updated artist with counts, or 404.

### `DELETE /api/artists/:id`

Deletes the watch. Posts and downloads are kept. Returns 204.

### `POST /api/artists/:id/search-now`

Runs the watch immediately across all configured indexers:

```json
{
  "ok": true,
  "seen": 250,
  "inserted": 12,
  "perSource": [
    { "source": "danbooru", "inserted": 8 },
    { "source": "gelbooru", "inserted": 4 }
  ],
  "errors": []
}
```

One broken indexer does not fail the whole run; its error lands in
`errors` while the other sources still report results.

### `POST /api/artists/batch`

Same actions as tag set batch: `enable`, `disable`, `search`, `delete`.

### `GET /api/artists/lookup?tag=wlop`

Probes every configured indexer with a small search (page 1, limit 5) in
parallel and reports where the artist posts. Unconfigured sources are
skipped. Requires the `tag` query parameter.

```json
{
  "tag": "wlop",
  "results": [
    { "source": "danbooru", "label": "Danbooru", "ok": true, "sampleCount": 5 },
    { "source": "e621", "label": "e621", "ok": false, "error": "HTTP 403 ..." }
  ]
}
```

## Library

### `GET /api/library`

Lists indexed posts, newest first by default. Query parameters:

| Parameter | Type | Effect |
| --- | --- | --- |
| `status` | string | `new`, `queued`, `downloading`, `downloaded`, `failed` |
| `source` | string | Indexer id, or `manual` for imported files |
| `tagSetId` | integer | Posts found by this tag set |
| `artistId` | integer | Posts found by this artist watch |
| `q` | string | Case insensitive substring match against the post's tags |
| `sort` | string | One of `added_desc` (default), `added_asc`, `posted_desc`, `posted_asc`, `score_desc`, `score_asc`, `source_asc` |
| `page` | integer | 1-based page number, default 1 |
| `pageSize` | integer | Default 40, clamped to 1-1000 |

`score` is the popularity metric each booru's API exposes (upvote/favorite
score, Danbooru `score`, Gelbooru family `score`, e621 `score.total`, ...)
captured at index time, so `score_desc` ("most relevant") works entirely
against the local library without re-querying the source site. Ties fall
back to newest-added. Posts imported manually always have `score: 0`.

Response:

```json
{
  "total": 1234,
  "page": 1,
  "pageSize": 40,
  "sort": "added_desc",
  "items": [ { "id": 1, "source": "danbooru", "sourcePostId": "12345", "tags": ["cat"], "status": "downloaded", "filePath": "danbooru/12345.jpg", "rating": "safe", "score": 120, "md5": "...", "ext": "jpg", "width": 1920, "height": 1080, "fileUrl": "https://...", "previewUrl": "https://...", "sourcePageUrl": "https://...", "postedAt": "...", "addedAt": "...", "downloadedAt": "...", "tagSetId": 1, "artistId": null } ]
}
```

Imported files have `source: "manual"`, `external: true` when the file
lives outside the library root, and `previewUrl` pointing at
`/library-files/:id`.

### `POST /api/library/:id/download`

Queues the post for download. Returns `{ "ok": true }`. Posts already
downloaded or in flight are ignored by the queue.

### `DELETE /api/library/:id`

Removes the post. If nyarr downloaded the file itself, the file on disk
is deleted too. Files referenced in place by a library import (external
posts) are never deleted. Returns 204.

### `POST /api/library/batch`

Body: `{ "action": "...", "ids": [...] }`. Actions:

| Action | Effect | Response |
| --- | --- | --- |
| `download` | Queues every selected post that is not already downloaded or in flight and has a file URL | `{ "ok": true, "queued": n, "skipped": m }` |
| `delete` | Removes the posts, same file rules as the single delete | `{ "ok": true, "deleted": n }` |

### `GET /api/library/tags`

Groups all downloaded posts by tag for the tag poster wall. Generic tags
like `highres` are excluded. The sample image is chosen deterministically
from the tag name so the wall stays stable across reloads.

```json
{
  "total": 57,
  "groups": [
    { "tag": "cat", "count": 120, "samplePostId": 42, "sampleUrl": "/library-files/42" }
  ]
}
```

Sorted by count descending, then tag name.

### `POST /api/library/organize`

Materializes the tag hierarchy on disk under
`<libraryRoot>/by-tag/<tag>/`. Uses hardlinks when possible, falls back
to copies (cross-device or filesystems that refuse links). External
posts are always copied, never linked. Existing entries are skipped, so
the call is idempotent.

```json
{
  "ok": true,
  "posts": 100,
  "linked": 180,
  "copied": 5,
  "failed": 0,
  "failures": [],
  "summary": "Organized 100 post(s) into by-tag/ - 180 linked, 5 copied"
}
```

`failures` holds up to 20 human readable messages.

### `POST /api/library/import`

Body: `{ "path": "/some/folder" }`. Scans the folder recursively (up to
8 levels deep) for jpg, jpeg, png, gif, webp, bmp, mp4, webm, apng, and
avif files and registers each as a library entry without downloading
anything. Files under the library root are adopted like normal
downloads; files outside it are referenced in place as absolute paths
and never moved or copied. Already-known files are skipped.

```json
{ "imported": 250, "skipped": 12, "scanned": 262 }
```

Errors: 400 if `path` is missing, or not an existing directory.

## Files

### `GET /library-files/:id`

Serves the file for a post by ID. This route is outside the `/api`
prefix and does not require the API key header (so plain `<a href>` and
`<img src>` work), but it is still protected by login authentication when
that is enabled. Returns 404 if the post does not exist or the file is
missing on disk.

The route deliberately looks files up by post ID rather than accepting a
raw path in the URL, so library imports pointing at arbitrary folders
cannot become a path traversal vector.

## Activity, stats, downloads

### `GET /api/activity`

Returns the most recent 100 activity entries, newest first:

```json
[
  { "id": 9, "message": "\"Cats\" (Danbooru): checked 100 post(s), found 3 new", "level": "success", "at": "2026-08-29T10:00:00.000Z" }
]
```

Levels: `info`, `success`, `warn`, `error`. The full history is capped at
500 entries.

### `GET /api/downloads/recent?limit=8`

Latest files that finished downloading, newest first. `limit` defaults
to 8 and is capped at 50.

```json
[
  { "id": 42, "source": "danbooru", "sourcePostId": "12345", "filePath": "danbooru/12345.jpg", "ext": "jpg", "tags": ["cat", "blue_eyes"], "downloadedAt": "..." }
]
```

### `GET /api/stats`

Dashboard counters:

```json
{
  "tagSets": 4,
  "tagSetsEnabled": 3,
  "totalPosts": 1200,
  "downloaded": 1100,
  "queued": 5,
  "failed": 2,
  "new": 93
}
```

`queued` counts both `queued` and `downloading` posts.

## System

### `GET /api/system/browse?path=/some/dir`

Directory listing used by the library-root folder picker. Lists
subdirectories (hidden folders excluded) of `path`, defaulting to the
server user's home directory. Paths resolve on the machine running the
server.

```json
{ "path": "/mnt/media", "parent": "/mnt", "directories": ["booru", "movies"] }
```

`parent` is `null` at a filesystem root.

### `GET /api/system/backup`

Downloads the entire dataset as a JSON attachment named
`nyarr-backup-YYYY-MM-DD.json`. Contains `general`, `settings`,
`tagSets`, `artists`, `posts`, `activity`. Note this includes the API key
and booru credentials in plaintext, so treat backup files as secrets.

### `POST /api/system/restore`

Body: a previously downloaded backup JSON object. Validates that the
expected top-level keys are present, then fully replaces all current
data. Returns `{ "ok": true }` or 400 if the file does not look like a
nyarr backup.

## Non-API routes

These routes do not require the API key header (they are HTML pages and
form handlers) but are covered by login authentication when enabled.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | The web UI. The API key and instance name are injected into the page |
| GET | `/setup` | First-run account creation page, only until an account exists |
| POST | `/setup` | Creates the account (form encoded: `username`, `password`, `password2`), enables basic auth, logs in |
| GET | `/login` | Login page, only when basic auth is enabled |
| POST | `/login` | Form encoded `username`, `password`, optional `remember`. Sets a session cookie (12h, or 30 days with remember) |
| POST | `/logout` | Clears the session cookie, redirects to `/login` |
| GET | `/library-files/:id` | Serves a post's file, see [Files](#files) |

## Data model

The full state lives in one JSON file (`db.json`, or `NYARR_DATA_DIR`).
Top-level keys: `general`, `settings`, `tagSets`, `artists`, `posts`,
`activity`, `queue`.

### Post object

| Field | Type | Notes |
| --- | --- | --- |
| `id` | integer | nyarr's own id |
| `source` | string | Indexer id, or `manual` for imports |
| `sourcePostId` | string | The post's id on the booru |
| `sourcePageUrl` | string or null | Link to the post on the booru |
| `tagSetId` | integer or null | Tag set that found it |
| `artistId` | integer or null | Artist watch that found it |
| `tags` | string[] | |
| `rating` | string | `safe`, `questionable`, `explicit`, or `unknown` for imports |
| `score` | number | |
| `fileUrl` | string or null | Full-size file URL on the booru |
| `previewUrl` | string or null | Thumbnail URL, or `/library-files/:id` for imports |
| `width`, `height` | number or null | |
| `md5` | string or null | Used for cross-source dedup |
| `ext` | string or null | |
| `postedAt` | string or null | When it was posted on the booru |
| `status` | string | `new`, `queued`, `downloading`, `downloaded`, `failed` |
| `filePath` | string or null | Relative to the library root, or absolute for external imports |
| `external` | boolean | True for imported files living outside the library root |
| `error` | string or null | Last download error, if any |
| `addedAt`, `downloadedAt` | string or null | ISO timestamps |

### Normalized search result shape

Every indexer adapter normalizes its API into this shape, which is what
the scheduler ingests:

```json
{
  "sourcePostId": "12345",
  "tags": ["cat", "blue_eyes"],
  "rating": "safe",
  "score": 120,
  "fileUrl": "https://...",
  "previewUrl": "https://...",
  "width": 1920,
  "height": 1080,
  "md5": "abc123",
  "ext": "jpg",
  "postedAt": "2026-01-01T00:00:00Z",
  "sourcePageUrl": "https://danbooru.donmai.us/posts/12345"
}
```

Ratings are normalized from each booru's own spelling (`s`/`g`,
`q`/`sensitive`, `e`) to `safe`, `questionable`, `explicit`.

### Rate limits and paging

The scheduler requests 100 posts per page with a 750 ms delay between
pages, and caps any single run at 100 pages (10,000 posts). Tag sets and
artist watches track a backfill cursor so a capped page budget eventually
covers the full history across successive runs instead of re-reading
page 1 forever.
