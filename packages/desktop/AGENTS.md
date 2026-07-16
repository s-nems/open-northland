# packages/desktop — the Electron shell

Packages the browser app for players: the same `packages/app` build served over `app://`, plus a
first-run installer that converts the user's owned game copy with the asset pipeline. The root
[`AGENTS.md`](../../AGENTS.md) carries the project-wide + legal rules.

## Boundaries

- **The web app stays shell-agnostic.** `packages/app` never imports desktop; the shell serves
  `packages/app/dist` byte-identical to the browser build and reuses the app's content routes via
  `@open-northland/content-routes` (the ONE route table, shared with the Vite dev middleware).
- **The pipeline runs out of process.** The conversion is CPU-bound; it always runs as a
  `utilityProcess` fork of the bundled `pipeline-child.cjs`, never on the main-process event loop.
  Progress rides the pipeline's `PipelineProgress` seam (`@open-northland/asset-pipeline/progress`
  is import-free by design — safe for the browser-side setup bundle).
- **Data lives in the data root, never in the install dir** (`src/paths.ts`): env override
  `OPEN_NORTHLAND_DATA_DIR` → `portable-data/` marker beside the executable → dev repo root →
  Electron `userData`. The pipeline writes `<dataRoot>/content`; `desktop-config.json` sits beside it.
- **Content staleness is stamp-compared, never guessed** (`src/content-state.ts`): the pipeline
  stamps `content/pipeline-manifest.json` last (also the completed-conversion marker); the shell
  compares it to its bundled `CURRENT_MANIFEST` — IR schema mismatch blocks play, an older
  `CONTENT_REVISION` (or no stamp) recommends regeneration. Shell-level actions (reinstall content,
  open data folder) live in the NATIVE app menu, never in the web app's UI.

## Build & run

- `npm run desktop` (repo root) — build everything, launch the shell. A dev run uses the repo root
  as its data root, so the checkout's generated `content/` boots straight into the game; set
  `OPEN_NORTHLAND_DATA_DIR` to an empty dir to exercise the first-run installer.
- `npm run desktop:dist` — electron-builder artifacts (`electron-builder.yml`): Windows NSIS +
  portable, macOS dmg, Linux AppImage; all unsigned (docs/tickets/tooling/desktop-code-signing.md).
- tsc typechecks only (`emitDeclarationOnly`); esbuild bundles the four runtime files into `dist/`
  (`scripts/bundle.mjs`) so electron-builder never packs workspace-symlinked node_modules.

## Verifying

Pure logic (paths, config, progress model) is unit-tested; the wizard + pipeline + game boot flow is
driven end-to-end with Playwright's `_electron` against the real game copy (local-only, like
`test:content`). Visual sign-off of the setup page and the in-shell game remains the user's.
