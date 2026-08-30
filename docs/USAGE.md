# nyarr user guide

nyarr is a self-hosted manager for booru image boards. You define saved
searches (tag sets and artist watches), nyarr polls them on a schedule,
indexes new matching posts, and optionally downloads them to disk. The
mental model is the same as Sonarr or Radarr, except the "series" is a tag
search instead of a TV show.

This guide covers installation, configuration, and day to day use. The
HTTP API is documented separately in [API.md](API.md).

## Contents

1. [Installation](#installation)
2. [First run](#first-run)
3. [Concepts](#concepts)
4. [Tag sets](#tag-sets)
5. [Artist watches](#artist-watches)
6. [The library](#the-library)
7. [Settings](#settings)
8. [Indexer credentials](#indexer-credentials)
9. [How the scheduler works](#how-the-scheduler-works)
10. [Storage layout](#storage-layout)
11. [Backup and restore](#backup-and-restore)
12. [Troubleshooting](#troubleshooting)

## Installation

Requirements: Node.js 18 or newer (Node 22 recommended, since the app uses
the built-in `fetch`).

```bash
npm install
npm start
```

Then open http://localhost:7373 in a browser.

There is no build step and no database server. Everything the app knows
lives in a single JSON file. On Windows you can also double click
`Start.bat`, which just runs `npm start`.

Useful commands:

| Command | What it does |
| --- | --- |
| `npm start` | Start the server |
| `npm run dev` | Start with auto-restart on file changes |

Environment variables:

| Variable | Purpose |
| --- | --- |
| `PORT` | Overrides the configured port for this run only |
| `NYARR_DATA_DIR` | Moves the app's data directory (the folder holding `db.json`) |

Example of relocating the data directory:

```bash
NYARR_DATA_DIR=/mnt/appdata/nyarr npm start
```

The data directory has to be set through the environment rather than a
setting inside the app, because the app needs to know where `db.json` is
before it can read any settings out of it.

## First run

On the very first start the app generates an API key, creates the default
library folder (`downloads/` next to the app), and starts listening.

Authentication is off by default. If you leave it off, anyone who can
reach the port can use the app, so only do this on a machine that is not
exposed to other people or the internet.

If you want a login, open the app once: it will redirect you to a setup
page where you pick a username and password. After that the whole app
(UI and API) sits behind a login page. The browser gets a normal login
form with a session cookie; API clients can use HTTP Basic auth or the
API key instead. See [Authentication](#authentication) below.

## Concepts

There are three main objects in nyarr:

- **Tag set**: a saved search pinned to one booru. For example
  "Danbooru, tags `cat blue_eyes -monochrome`, check every 60 minutes".
- **Artist watch**: a saved search for one artist tag, run against every
  booru you have configured at once. Use this when you care about an
  artist rather than a subject.
- **Post**: one indexed image or video. Posts start as `new` and move
  through the download queue to `downloaded` (or `failed`).

Posts are deduplicated two ways: by `(source, post id)` and by file MD5
hash. The same image reposted on two boorus, or appearing under two tag
sets, only enters the library once.

## Tag sets

A tag set is defined by:

| Field | Meaning |
| --- | --- |
| Name | Display name, anything you like |
| Source | Which booru to search (Danbooru, Gelbooru, e621, Rule34, and more) |
| Tags | Booru tag query, e.g. `cat blue_eyes -monochrome` |
| Rating filter | `safe`, `safe + questionable`, or `all` |
| Min score | Skip posts whose score is below this |
| Check interval | Minutes between automatic checks |
| Max pages | Page budget per run, see below |
| Auto download | Download new matches without asking |
| Enabled | Disabled tag sets are skipped by the scheduler |

The tag query uses each booru's own search syntax, including meta tags
like `score:>100` or `order:score` where the booru supports them.

### The maxPages setting

`maxPages` controls how many result pages (100 posts per page on most
boorus) a single run may walk:

- **Empty (auto)**: the first run backfills 3 pages, then each later run
  checks 1 page for new posts. If a backfill run runs out of budget
  before reaching the end of the tag's history, the next run resumes
  where it stopped, so the full history is eventually covered.
- **A number**: a fixed page budget per run. Successive runs resume from
  where the previous one stopped until the history is exhausted.
- **0**: walk everything, up to a hard safety cap of 100 pages (10,000
  posts) per run.

There is a 750 ms delay between page requests to the same booru so a
backfill does not hammer the API.

## Artist watches

An artist watch searches one artist tag (for example `wlop`) on every
indexer you have added credentials for, all at once. This is the main
difference from tag sets, which are pinned to a single source.

Per-source page budgets are tracked independently, since each booru has
its own history depth and rate limits. Cross-source deduplication by MD5
means artwork reposted to several boorus only lands in the library once.

When adding an artist you can use the lookup feature (the UI offers it on
the artist form) to probe every configured indexer and see where that
artist actually posts before committing to a watch.

## The library

The library page lists every indexed post. You can filter by status,
source, tag set, artist, or free text search across tags. Each post can
be downloaded manually, opened, or deleted.

Post statuses:

| Status | Meaning |
| --- | --- |
| `new` | Indexed but not queued for download |
| `queued` | Waiting in the download queue |
| `downloading` | Currently being fetched |
| `downloaded` | File is on disk |
| `failed` | Download failed, the error is recorded on the post |

Downloads are sequential (one at a time). Files are written to
`<library root>/<source>/<postId>.<ext>`.

### Tag view and organize

The tag view groups everything downloaded by tag and shows a poster wall.
The "Organize" action materializes that grouping on disk: it creates
`<library root>/by-tag/<tag>/` folders and fills them with hardlinks to
the downloaded files (falling back to copies when hardlinking is not
possible, for example across drives). A handful of useless generic tags
like `highres` are skipped as grouping buckets. Posts with no usable tags
land in `_untagged`. Re-running organize skips entries that already
exist, so it is safe to run repeatedly.

### Library import

Already have a folder of booru images from somewhere else? Point the
import at it and nyarr registers every image it finds as a library entry
without re-downloading anything.

- Files under the current library root are adopted exactly like a normal
  download (stored as a relative path).
- Files outside the library root are referenced in place as absolute
  paths. They are never moved or copied, and deleting such an entry from
  the library never deletes the source file.
- Re-running an import on the same folder skips files it has already
  seen.
- The scan walks up to 8 levels deep and recognizes jpg, jpeg, png, gif,
  webp, bmp, mp4, webm, apng, and avif files. The generated `by-tag`
  folder is skipped so re-importing the library root does not create
  duplicates.

## Settings

The settings page has two tabs.

### General

- **Instance**: display name (shown as the page title and sidebar
  wordmark) and port. Changing the port needs a restart to take effect.
- **Library location**: where downloaded files live, with a built-in
  folder browser. Note the browser lists folders on the machine running
  the server, not on your local machine if you are accessing nyarr
  remotely. Takes effect immediately, no restart needed. Existing
  download records store paths relative to the root, so moving the root
  does not orphan them.
- **Authentication**: off by default. Switch to Basic to require a
  username and password for the whole app.
- **API key**: auto-generated on first run, required on every `/api/*`
  request. Regenerate it if you think it has leaked; external clients
  will need the new key.
- **Backup and restore**: download the entire dataset as one JSON file,
  or restore from a previously downloaded one. Restoring fully replaces
  current data, so the UI asks for confirmation first.

### Indexers

Per-booru credentials. See the next section.

## Indexer credentials

Credentials are entered in Settings, then verified with the "Test
connection" button. What each booru needs:

| Booru | Credentials | Where to get them |
| --- | --- | --- |
| Danbooru | Username + API key | Your account's API Key page |
| Gelbooru | User ID + API key | My Account, Options, API Access Credentials |
| e621 | Username + API key + user agent | Account, API Access. e621 rejects requests without a descriptive user agent such as `myapp/1.0 (by yourusername)` |
| Rule34 | User ID + API key | Account API settings. As of Aug 2025 both are required on every API request, searches fail without them |
| Safebooru, Konachan, Yande.re, Furbooru, Sankaku, Realbooru, TBIB, Behoimi | Varies, see the credential fields in Settings | Account pages on each site |

Danbooru, Gelbooru, and e621 still work without an API key for public or
safe content, but rate limits are much stricter. Some sources (Rule34,
Sankaku, Realbooru, Behoimi) effectively require credentials.

"Test connection" confirms the credentials are present and that a request
with them succeeds. It cannot always detect a wrong-but-present key, so
if tests pass but searches return nothing, double check the key on the
site itself.

Artist watches only query indexers you have actually entered credentials
for, so unconfigured sources do not bury real results under errors.

## How the scheduler works

A scheduler ticks every minute. Any enabled tag set or artist watch whose
check interval has elapsed gets re-queried. For each run:

1. Walk the configured number of result pages, with a politeness delay
   between pages.
2. Filter results by rating and minimum score.
3. Skip anything already indexed (by source post id or MD5).
4. Insert new posts, queueing downloads immediately if auto download is
   on.
5. Record the check time and, if the run hit a short or empty page, mark
   the backfill complete so future runs only need one page.

Errors are recorded on the tag set or artist (`lastError`) and in the
activity feed, and the run is retried at the next interval.

## Storage layout

Two separate locations can be configured:

- **Library root** (downloaded files): set at runtime from Settings,
  General, Library location. Default is `downloads/` next to the app.
- **Data directory** (`db.json` with tag sets, artists, posts, indexer
  credentials, activity log): set via `NYARR_DATA_DIR` before starting.

Inside the library root:

```
<library root>/
  danbooru/12345.jpg        normal downloads, one folder per source
  gelbooru/67890.png
  by-tag/<tag>/...          generated by the Organize action (hardlinks)
```

Inside the data directory there is just `db.json`. Passwords are salted
and hashed with scrypt and never stored in plaintext. Booru API
credentials and the API key are stored in plaintext in `db.json`, the
same way Sonarr and Radarr store indexer credentials in `config.xml`.
That is fine for local self-hosting, but do not commit the file and do
not expose the app beyond localhost without enabling authentication.

## Backup and restore

Settings, General, Backup downloads the entire dataset (settings, tag
sets, artists, posts, activity) as a single JSON file. Restore uploads a
previously downloaded file and fully replaces current data after a
confirmation prompt. Downloaded image files themselves are not included
in a backup, only the records pointing at them, so keep the library
folder safe separately.

## Authentication

Three mechanisms, in the order the server checks them:

1. **Session cookie**: the web UI's login page sets a signed cookie
   valid for 12 hours, or 30 days if you tick "remember me".
2. **HTTP Basic auth**: for curl and other API clients, use the username
   and password you created during setup.
3. **API key**: every `/api/*` request needs the `X-Api-Key` header (or
   Basic auth). The bundled web UI gets the key injected automatically.

When authentication is off, the API key is still required on `/api/*`
requests. The web UI handles this for you; only script authors need to
copy the key from Settings.

## Troubleshooting

- **Searches return nothing but the connection test passes.** The key or
  user id may be wrong in a way the test cannot detect. Re-check the
  credentials on the booru's account page.
- **e621 or Furbooru searches fail immediately.** Both require a
  descriptive user agent. Set one in the indexer settings.
- **Rule34 searches fail.** Both user id and API key are required on
  every request as of Aug 2025.
- **A tag set shows an error.** Check `lastError` on the tag set and the
  activity feed. Common causes are rate limiting (raise the check
  interval or lower max pages) and missing credentials.
- **Downloads fail.** The post records the error message. Some boorus
  block hotlinking of full-size files; if a specific post keeps failing,
  open its source page URL from the library to check the file still
  exists there.
- **Port already in use.** Change the port in Settings (then restart) or
  start with `PORT=8080 npm start`.
- **Moved the library folder and images vanished.** Set the new location
  in Settings, General, Library location. Records store paths relative to
  the root, so pointing back at the moved folder restores everything.
