# Map catalogue API

## API server

```bash
npm run api
PORT=9000 API_SYNC_INTERVAL=30m npm run api
```

`npm run api` builds the workspace and starts `packages/api`. The server keeps a local catalogue,
archives and converted maps, and stores the bug reports players send. It runs no simulation.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8790` | HTTP port |
| `HOST` | all interfaces | Bind address |
| `API_BUILD` | unset | Build name in `/healthz` |
| `ON_API_UPSTREAM` | `https://api.culturesnation.pl` | Upstream catalogue |
| `ON_API_DATA_DIR` | `.api-data` | Storage directory, relative to the working directory |
| `API_SYNC_INTERVAL` | `6h` | Whole seconds or one `s`, `m`, `h`, `d` unit; 1 minute to 7 days |
| `API_CONVERT_CONCURRENCY` | `1` | Concurrent download/conversion jobs; 1 to 8 |
| `API_CONVERT_TIMEOUT_SECONDS` | `120` | Worker lifetime including startup; 1 to 600 seconds |
| `ON_API_REPORTS_DIR` | `.api-reports` | Bug report directory, relative to the working directory |
| `API_TRUST_FORWARDED_FOR` | `0` | `1` keys report limits on the last `X-Forwarded-For` entry; set only behind a proxy that overwrites it |
| `API_REPORT_ORIGINS` | `https://game.opennorthland.org,app://game` | Comma-separated browser origins allowed to post reports; loopback `http` origins are always allowed |

Report limits ([bug reports](#bug-reports)), each a positive integer:

| Variable | Default |
| --- | --- |
| `API_REPORT_MAX_BYTES` | 524288 (512 KiB compressed report) |
| `API_REPORT_ADDENDUM_MAX_BYTES` | 8388608 (8 MiB compressed addendum) |
| `API_REPORT_MAX_INFLATED_BYTES` | 2097152 (2 MiB inflated report) |
| `API_REPORT_ADDENDUM_MAX_INFLATED_BYTES` | 16777216 (16 MiB inflated addendum) |
| `API_REPORT_IP_HOURLY`, `API_REPORT_IP_DAILY` | 6, 20 reports per client; three times that per IPv6 /56 |
| `API_REPORT_IP_ADDENDA_HOURLY` | 6 addenda per client; three times that per IPv6 /56 |
| `API_REPORT_GLOBAL_HOURLY` | 200 uploads kept from all clients |
| `API_REPORT_GLOBAL_HOURLY_BYTES` | 268435456 (256 MiB from all clients: each upload's compressed body, or the files it decoded to when larger) |
| `API_REPORT_IP_HOURLY_BYTES` | 16777216 (16 MiB of those bytes per client; three times that per IPv6 /56) |
| `API_REPORT_FINGERPRINT_DAILY` | 10 stored reports per error fingerprint, one per client; reports with a comment or contact are not capped |
| `API_REPORT_MAX_STORED_BYTES` | 2147483648 (2 GiB stored) |
| `API_REPORT_MAX_STORED` | 20000 stored reports |

The app defaults to `https://api.opennorthland.org`. Set `ON_API_URL` when starting Vite or building
the app, or use `?api=http://127.0.0.1:8790` for one session. Electron uses the build's API setting.

### Sync and conversion

1. At startup and each sync interval, fetch all upstream catalogue pages and normalize map/campaign
   metadata. This refreshes the list, not every archive. The wikinger-tommy.de mapdb is fetched the
   same way, by posting the search form its own site drives, and both sources merge into one
   catalogue. An entry's id prefix names its source: `cn-` for culturesnation.pl, `wt-` for the
   mapdb; the client derives the catalogue's source filter from it. The mapdb carries no dates, so
   an entry keeps the dates of its first sync until its record changes.
2. Download new or changed archives (`updatedAt`). Keep unchanged archives and conversions.
3. Convert each eligible `archive` or `c2m` in a disposable Node worker, with the repository's
   translation overlays. External hosts stay as manual download links. A timeout or crash stops that
   worker; the queue continues with a fresh one.
4. Publish conversion results after the batch. The catalogue ETag changes with its contents.

Conversions are `pending`, `ok` or `failed`. Failure reasons are `no-map`, `too-large`,
`unsupported-archive`, `decode-failed` and `download-failed`; worker failures use `decode-failed`.
Downloads retry on the next sync. Stored failures retry once per process and when the entry changes.
A failed replacement keeps the previous good conversion and retries on a later sync.

A failed sync keeps the last good catalogue. An empty upstream result cannot replace a non-empty
catalogue, and a failing source fails the whole sync. Logs are JSON lines and include reasons for
rejected records. Shutdown aborts downloads, stops workers and waits for storage operations.

### Translation overlays

The server loads the map overlays under `translations/<lang>/maps/` once at start
([contract](../translations/AGENTS.md)) and hands every worker a copy. A catalogue map takes the
overlay of its `map.dat` written against its text, as the pipeline does. A catalogue archive counts
as a community map, so an overlay in a source language applies too. A converted map's `languages`
lists every language its string table carries, overlays included. The loader finds `translations/`
beside `packages/`, in a checkout and in the image alike.

A stored conversion records a fingerprint of the overlays filed under each converted map's `map.dat`
digest, every variant file and an empty set included. When the server starts with other overlays
under a digest (one added, changed or removed), each entry holding that map converts again from its
kept archive on the next catalogue, without an IR change; the other entries keep their conversions.

### Request limits

- Automatic downloads allow HTTPS on `culturesnation.pl`, `www.culturesnation.pl`,
  `api.culturesnation.pl`, `wikinger-tommy.de` and `www.wikinger-tommy.de`, plus the exact
  configured upstream origin (scheme and port included).
- URLs with credentials and all redirects are refused. Other HTTP(S) archives are manual links;
  untrusted screenshot URLs are omitted.
- Catalogue limits: 2 MiB and 100 records per page; 16 MiB, 5000 records and 100 pages per sync.
  Byte limits apply after decompression, before JSON parsing. A rejected page fails the sync.
  The mapdb list is HTML text under the same page and byte budgets; its download links must be
  `download.php?datei=` links to a `.exe` on its own origin.
- Archive conversion uses the shared importer limits, including a 64 MiB archive limit.

## Endpoints

All resource routes accept `GET` and `HEAD`; the report routes accept only `POST`.

| Path | Response |
| --- | --- |
| `/healthz` | Build, last sync time, staleness, entry count, conversion counts, whether the report store is `full` and whether the report decoder is failing (`decoderFailing`); 503 until a catalogue is loaded |
| `/v1/catalog` | Compact `CatalogBrowse` list, sorted by id |
| `/v1/maps/<id>` | Full `CatalogEntry`, including map indexes and lobby rosters |
| `/v1/maps/<id>/thumbnail` | Screenshot or 404 |
| `/v1/maps/<id>/file` | Original archive as an attachment, or 404 |
| `/v1/content/<irVersion>/maps/<mapId><suffix>` | Converted map file; another IR version returns 404 and names the served version |
| `POST /v1/reports`, `POST /v1/reports/<id>` | A bug report and its addendum; see [bug reports](#bug-reports) |

Map suffixes: `.json`, `.meta.json`, `.strings.json`, `.script.json`, `.briefing.json`, `.png` and
`.pictures-<16hex>.png`. Schemas live in `packages/data`.

HTTP behavior:

- `/v1` reads allow all CORS origins. `OPTIONS` returns 204 and allows `GET`, `HEAD`, `If-None-Match`.
- Resources have SHA-256 ETags and cache policies. Matching `If-None-Match` returns 304.
  Errors are non-cacheable JSON: `{ "error": "..." }`.
- The list supports precompressed gzip, `Vary: Accept-Encoding` and a separate ETag per representation.
- Map JSON is stored as gzip. Clients accepting gzip receive it directly; others receive an inflated
  stream without `Content-Length`. Its ETag hashes the uncompressed bytes; reuse requires revalidation.
- Archive verification reuses unchanged inode, size and timestamp identities; responses retain their
  verified open inode. At most two hash passes and 32 verification requests run at once; overload
  returns 503 with `Retry-After`. Disconnects cancel verification when no other requester needs it.
- Thumbnail and archive links include `?v=<sha256>`; these routes ignore that query parameter.

## Stored files

All paths are relative to `ON_API_DATA_DIR`. The default `.api-data/` is gitignored.

| Path | Content |
| --- | --- |
| `catalog.json` | Last good normalized catalogue |
| `raw/<page>.json` | Upstream pages |
| `thumbnails/<id>` and `<id>.json` | Screenshot and metadata: content type, `updatedAt`, SHA-256 |
| `archives/<id>/<sha256>.<ext>` and `source.json` | Original archive, source URL and `updatedAt` |
| `converted/<irVersion>/<id>/conversion.json` | Manifest: generation, verdict, file hashes and overlay fingerprints by `map.dat` digest |
| `converted/<irVersion>/<id>/<generation>/<mapId><suffix>` | Converted files; JSON files have an extra `.gz` suffix |

On an IR version change, the API deletes old converted versions and rebuilds from retained archives.
Removed catalogue entries lose their archive and conversion. A replacement writes a complete
new generation before atomically replacing its manifest; existing readers keep their open files.
Incompatible manifests trigger reconversion.

## Bug reports

The game posts `ReportUpload` (`packages/data`) as gzipped JSON with `Content-Type: text/plain`, a
type browsers send without a preflight. `POST /v1/reports` takes `part: 'report'`. `POST
/v1/reports/<id>` takes `part: 'addendum'` with the same 32-hex `id`: the player's comment, contact
and heavier attachments. It answers 404 before reading the body unless `id` names a stored report.
Each report takes one addendum; a later one is answered 204 as a retry and stores nothing. The
random `id` is the addendum's only key. `packages/data` owns the wire contract both sides build on:
the field bounds (`REPORT_LIMITS`), the default upload caps (`REPORT_UPLOAD_LIMITS`), the JSON shape
the server parses (`REPORT_JSON_SHAPE`) and the statuses below (`REPORT_STATUS`).

| Status | Meaning |
| --- | --- |
| 204 | Stored; also a retried report or addendum already stored |
| 202 | A report only counted, body `{ "outcome": "counted" }`: past its fingerprint's daily cap, or its client's second of that fingerprint that day. It takes no addendum; send the player's additions as a new report. A report with a comment or contact is never only counted |
| 400 | Not JSON, nested deeper than 16 brackets, an object of more than 1024 members, more values (containers and separators) than the inflated limit divided by 12, refused by the schema, the wrong part for the path, an attachment whose bytes are not its type, or too costly to decode |
| 403 | An `Origin` header that is not allowed |
| 404 | The addendum's report is not stored |
| 413 | Compressed body or inflated JSON over its limit, by `Content-Length` or while reading |
| 415 | Not `text/plain`, a `Content-Encoding`, or a body that is not gzip |
| 429, 503 | Rate limited or busy, with `Retry-After` |
| 500 | A fault of the server, such as a decoder process that cannot start; the upload's global slot is given back |
| 507 | Storage full, answered before the body is read; the server never deletes reports to make room |

Error bodies are fixed `{ "error": "..." }` texts that never echo the input. Requests without
`Origin` (tools, Node) are allowed. An allowed origin gets `Access-Control-Allow-Origin: <origin>`
and `Vary: Origin`, and may read `Retry-After` (`Access-Control-Expose-Headers`). A body refused before it was read whole, or past its limit, is read and dropped
for up to 2 seconds so the client gets the answer; then the connection closes.

Limits are in the table above. A wrong type answers 415 before any limit is spent. Per-client limits
use sliding windows and are checked for the path's part, with the client's byte share, before the
body is read; a body the server cannot read or validate also spends the client's slot for the other
part. The global hourly upload count only keeps uploads that stored or counted something: a refused,
aborted or failed one gives its slot back. The report count cap stops new reports only; an addendum
to a stored report is stopped by the byte cap alone. A write that would pass the byte cap, or a disk
out of space, answers 507 as well. Uploads in flight are capped. One upload at a time is inflated,
validated and turned into its files in a child process with a 256 MB heap and a 10-second deadline.
The shape bounds above keep the costliest JSON within the default limits to about 170 MB of that
heap; a body that still exhausts the heap or the deadline ends only the child, is a 400, and the
next upload starts a new one. A child that dies while idle is started again for the next upload; one
that cannot start fails that upload at once with a 500 and sets `decoderFailing` until a decode
succeeds. Clients are keyed by a keyed hash of their address (an IPv6 address by its /64, and its
/56 for the coarser limit) held only in memory. Client addresses are never logged or stored.
Each client counts once toward a fingerprint's daily cap, so one client cannot use it up for everyone.
A report with a comment or contact is always stored and does not count toward the cap.
Fingerprint counts are in memory, so a restart starts the day's counts over.

### Stored reports

Paths are relative to `ON_API_REPORTS_DIR`; the server names every file. The default
`.api-reports/` is gitignored.

| Path | Content |
| --- | --- |
| `<YYYY-MM-DD>/<HHMMSS>Z-<trigger>-<id>/report.json` | The report without attachments; date and time in UTC |
| `.../commands.json` | `{ commandsFromTick, commands }` |
| `.../save.json.gz` | The save file as sent, after a gzip signature check |
| `.../screenshot.webp`, `.jpg` or `.png` | The decoded screenshot, after a signature check |
| `.../settings.json` | The player's settings |
| `.../addendum.json` | The addendum's `comment`, `contact` and `receivedAt` |
| `<YYYY-MM-DD>/suppressed.json` | Reports only counted, by fingerprint |

The JSON files a person reads (`report.json`, `settings.json`, `addendum.json`) have their top three
levels one member per line and deeper values on one line, so a file stays within a small factor of
the JSON sent however deep its free-form fields are.

Attachments sent with the report or its addendum land in the same directory. An addendum never
replaces a file the report already has. Each report is written in `.tmp/`, made again when deleted,
and renamed into place; an addendum's files are linked in with `addendum.json` last. Delete report directories by hand at
any time: every 5 minutes, and at start, the server recounts reports and bytes and rebuilds its id
index from the directory names. The contact field is the only personal data, and it is optional.

## Import and play flow

| Part | Responsibility |
| --- | --- |
| API `catalog/` | Fetch and normalize upstream metadata and thumbnails |
| API `conversion/` | Download, retain and convert archives before players request them |
| `packages/formats` | Decode file formats |
| `packages/map-import` | Open archives, enforce limits and produce map documents; shared by API, pipeline and app |
| App `content/local-import/` | Convert selected/dropped files in a Worker; retain the source for manual reloads; no upload |
| App `content/map-source/` | Resolve shipped, catalogue and local maps through one loading interface |

The catalogue filters and sorts the compact list locally; search includes both descriptions.
Selecting an entry fetches its full details. Installation downloads and validates all its converted
maps, including campaign submaps, briefing text and images. The API uses files on disk, not a database.

Web installs use IndexedDB; desktop installs use files on disk. Both publish source and converted
files atomically. After an IR change, old maps stay listed but cannot play: catalogue maps need a
new download; local maps need an explicit reload from their retained input. An installed catalogue
map is current while the catalogue lists its `fingerprint` and `languages`: a language a translation
overlay added or removed offers the entry as an update, a text changed within a listed language does
not. Opening the library does not start conversions. Desktop file selection uses validated IPC and
rejects symlinks. Import limits apply on both hosts; desktop storage has no aggregate budget.

Map ids use `<entry id>-<folder slug>`, with `-2`, `-3` for duplicate slugs. `folder` and the terrain/script
`fingerprint` let the client detect maps already shipped with the game. Exact matches play the shipped
copy; partial or different versions can be downloaded. `kind` and `series` come from upstream category
keywords; unknown categories use `other`, and `categoryLabel` retains the original text.

Playing still requires shared game content: sprites, audio and rules. Multiplayer uses the same map
selection flow; the room protocol handles map transfer, not this HTTP API.

## Fresh checkout and offline replay

Normal `npm run dev` uses the public API. The mock is an offline replay server, not a downloader or
an example catalogue. A fresh checkout has no replay cache.

Prepare the local cache once against the live upstream:

```bash
ON_API_DATA_DIR=.api-upstream-cache npm run api
```

Wait for conversion to finish, then stop it. In three separate terminals:

```bash
npm run api:upstream-mock
ON_API_UPSTREAM=http://127.0.0.1:8791 npm run api
ON_API_URL=http://127.0.0.1:8790 npm run dev
```

The mock reads gitignored `.api-upstream-cache/`; the API writes `.api-data/`. The app connects to
8790, not the mock on 8791. Build [base game content](DEVELOPMENT.md#local-game-content) separately.

Mock details:

- Listens on `127.0.0.1:8791`; `PORT` changes the port.
- `ON_UPSTREAM_CACHE_DIR` optionally selects another cache directory.
- Reads the `raw/`, `archives/` and `thumbnails/` layout above. Rewrites catalogue file/image URLs
  to its own origin and logs requests. Pages after the last cached page return empty `data`.
- Missing required directories prevent startup. Missing archives and unknown routes return 404.

Synthetic API tests need no downloaded maps:

```bash
npx vitest run --project core packages/api
```

## API image

```bash
npm run api:image
docker run --rm -p 127.0.0.1:8790:8790 -v on-api-data:/data -v on-api-reports:/reports open-northland-api
curl -s http://127.0.0.1:8790/healthz
```

`packages/api/Dockerfile` supports `linux/amd64` and `linux/arm64`. It includes compiled API,
map-import, formats, data and translations packages, the repository's `translations/` overlays at
`/app/translations`, and runtime dependencies. It contains no Pixi or game content. Archives and
converted maps stay in `/data`, bug reports in their own volume `/reports`. A new overlay reaches the
catalogue with the next image.

Defaults: `PORT=8790`, `ON_API_DATA_DIR=/data`, `ON_API_REPORTS_DIR=/reports`. The `API_BUILD` build argument sets the reported build.
Health becomes ready after the first catalogue sync; conversion continues in the background.
