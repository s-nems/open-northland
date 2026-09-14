# Write the served content layout and static indexes from the pipeline

**Area:** pipeline, content-resolver, data, app, desktop · **Focus:** content delivery · **Priority:** P2
**Blocked by:** [Remove the runtime content install](content-in-build-1-remove-runtime-install.md)

The app fetches root-relative content URLs (`/bobs/<stem>.png`, `/textures/<key>.png`, `/maps/…`,
`/ir.json`) from 29 files, while the pipeline writes `Data/engine2d/bin/bobs`,
`Data/engine2d/bin/textures`, `Data/engine2d/bin/sounds` and `Data/gui/bitmaps`
(`tools/asset-pipeline/src/stages/content-tree.ts`). `packages/content-resolver` bridges the two
in every host and computes `/maps-index`, `/bobs-index` and `/backdrops-index` per request by
scanning the tree. With content served as static files by nginx and Electron, no host can run
that code, and the pipeline also leaves unserved intermediates (`Data/text`, `CnModMaps`) in
`content/` that would otherwise be copied into every artifact.

Required end state: the tree the pipeline writes is exactly the tree the app fetches, the three
indexes are files the pipeline writes, and `packages/content-resolver` no longer exists.

## Scope

- Pipeline output roots become `bobs/`, `textures/`, `sounds/`, `gui-bitmaps/`; `DATA_DIR` goes.
  Follow every writer and reader of those constants (`run.ts` reads textures back for the masked
  transition pages). Intermediates the app never fetches are written to a temporary work directory
  or not at all. After a run, `content/` holds only `ir.json`, `pipeline-manifest.json`, the three
  index files, and `maps/`, `bobs/`, `textures/`, `sounds/`, `music/`, `gui/`, `gui-bitmaps/`,
  `goods/`, `backdrops/`. Apply the generated-content gate in `packages/data/AGENTS.md` for the
  layout change. Art-pipeline review folders a developer may have under `content/` are not this
  pipeline's output and are out of scope.
- Move `maps-index.ts`, `bobs-index.ts`, `backdrops-index.ts` and `dir-listing.ts` into a final
  pipeline stage that writes `maps-index.json`, `bobs-index.json` and `backdrops-index.json` at the
  content root. Their wire types (`MapsIndexEntry`, `MapsIndexPlayerSlot`, `MapsIndexProvenance`,
  `BobsIndexEntry`) move to `packages/data` as sidecar schema; the app and its tests import them
  from there.
- App: the four index fetches (`content/maps-index.ts`, `entries/icons.ts`,
  `entries/main-menu/backdrops.ts`, `content/transfer/room.ts`) request the `.json` files. No
  other app URL changes.
- Vite: `serveContent` in `packages/app/vite.config.ts` streams the requested file from the content
  root when it exists (percent-decoded, containment-checked, content type by extension), answers 404
  for a miss whose first path segment is one of the content roots above so the SPA fallback cannot
  serve `index.html` as content, and passes everything else through.
- Desktop `protocol.ts`: serve the path under the app root, else under the content root, else 404;
  keep the host folding in `routePathOf`; inline the containment check the resolver did and read
  through `node:fs` directly, so the desktop no longer depends on `@open-northland/vfs`.
- `CONTENT_REVISION` (`tools/asset-pipeline/src/manifest.ts`) lost its only reader with the
  installer; delete it and the manifest field rather than bumping it. `IR_VERSION` stays as the gate
  between a developer's `content/` and the build.
- The app is always served from `/` now: delete `OPEN_NORTHLAND_BASE_PATH` in `vite.config.ts` and
  `withBaseUrl` (`packages/app/src/base-url.ts`), calling `fetch` with the root-relative path.
- Delete `packages/content-resolver` (workspace, root `tsconfig.json` reference, `AGENTS.md`
  contract entry, `check-docs.mjs` area and the `docs/tickets/README.md` area list). Move its tests:
  sidecar parsing and index shape to the pipeline stage, containment to the desktop protocol test.
- Non-goal: a `/content/` URL prefix; the root-relative URLs the app builds do not change.

## Verify

`npm run check`, `npm run check:docs`, `npm run typecheck`, `npm run build`, Vitest for
`tools/asset-pipeline`, `packages/data`, `packages/app`, `packages/desktop`. `npm run test:pipeline`
against `../CNMod-1.3.2`, then `ls` of its output equals the list above and nothing else.
`npm run test:content` over a fresh conversion. In Vite: the map list shows minimaps, unit and good
icons render, backdrops rotate, a map starts; `curl -sI localhost:5173/maps-index.json` is 200
`application/json` and `curl -sI localhost:5173/maps/nope.json` is 404, not an HTML 200.
`npm run desktop` passes the same menu and map checks.
