# Catalogue API contract

Read the root contract first. Run/configuration and endpoint documentation live in
[`docs/API.md`](../../docs/API.md).

- `catalog/` owns upstream normalization and synchronization; `conversion/` owns archive download,
  conversion scheduling and durable generations; `http/` owns HTTP responses and file streaming;
  `reports/` owns bug report intake, limits and storage; `news/` owns the menu news file and its check CLI. `server.ts` owns routing and lifecycle. Keep the upstream's schema out of client-facing contracts.
- `test/` mirrors `catalog/`, `conversion/`, `http/`, `news/`, `reports/`, `upstream/` and `upstream-mock/`; `server.ts`,
  config and end-to-end tests stay at its root, fixtures in `test/support/`.
- API contracts belong in `packages/data`. Decode formats in `packages/formats` and share map
  conversion through `packages/map-import`; do not duplicate them here or run game simulation.
- Convert catalogue archives ahead of requests. Persist originals and versioned converted files on
  the data volume, not in Git or the image. Serve only this build's IR version; replace older
  converted caches from retained originals, without migration.
- Validate untrusted downloads and archive resource limits. Publish complete generations atomically;
  stream verified open files and close handles on success, HEAD, conditional requests and failure.
- Keep the last good catalogue on upstream failure. Public `/v1` reads support GET/HEAD, conditional
  requests and CORS. The only public write is a bug report: bounded before, during and after reading,
  rate-limited, server-named on disk, never deleting to make room, never storing or logging client
  addresses. Other writes need their own policy. Never proxy arbitrary URLs.
- Keep host I/O and scheduling here. Shared conversion remains usable by the pipeline and browser
  Worker. The offline upstream mock replays an existing cache and must not fetch missing files.
- Log structured JSON events. Tests use synthetic upstream pages and archives, with temporary data
  directories and no dependency on live hosts or local catalogue caches.

Run focused API tests for HTTP/storage changes and shared import tests for conversion changes,
then the applicable gates in [`docs/TESTING.md`](../../docs/TESTING.md).
