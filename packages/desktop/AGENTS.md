# packages/desktop — the Electron shell

Packages the browser app for players: the same `packages/app` build served over `app://`, plus a
first-run installer that converts the user's owned game copy with the asset pipeline. The root
[`AGENTS.md`](../../AGENTS.md) carries the project-wide + legal rules.

## Boundaries

- **The web app stays shell-agnostic.** `packages/app` never imports desktop; the shell serves
  `packages/app/dist` byte-identical to the browser build and reuses the app's content routes via
  `@open-northland/content-resolver` (the single route table, shared with the Vite dev middleware).
- **The pipeline runs out of process.** The conversion is CPU-bound; it always runs as a
  `utilityProcess` fork of the bundled `pipeline-child.cjs`, never on the main-process event loop.
  Progress rides the pipeline's `PipelineProgress` seam (`@open-northland/asset-pipeline/progress`
  is import-free by design — safe for the browser-side setup bundle).
- **Data lives in the data root, never in the install dir** (`src/paths.ts`): env override
  `OPEN_NORTHLAND_DATA_DIR` → `portable-data/` marker beside the executable → dev repo root →
  Electron `userData`. The pipeline writes `<dataRoot>/content`; `desktop-config.json` sits beside it.
- **The culturesnation mod is required and never touches the game folder.** A game install without
  `DataCnmd/` gets the wizard's mod step: auto-download from culturesnation.pl into
  `<dataRoot>/mods/` (`src/mod-install/` — the Drive hop chain, pinned-hash warning, own zip
  reader in `src/zip.ts`) or a hand-picked unpacked copy (remembered as `modPath` in the config);
  either way the pipeline child gets it as `--mod-root`.
- **Content staleness is stamp-compared, never guessed** (`src/content-state.ts`): the pipeline
  stamps `content/pipeline-manifest.json` last (also the completed-conversion marker); the shell
  compares it to its bundled `CURRENT_MANIFEST` — IR schema mismatch blocks play, an older
  `CONTENT_REVISION` (or no stamp) recommends regeneration. Shell-level actions (reinstall content,
  open data folder) live in the native app menu, never in the web app's UI.

## Build & run

- `npm run desktop` (repo root) — build everything, launch the shell. A dev run uses the repo root
  as its data root, so the checkout's generated `content/` boots straight into the game; set
  `OPEN_NORTHLAND_DATA_DIR` to an empty dir to exercise the first-run installer.
- `npm run desktop:dist` — electron-builder artifacts (`electron-builder.yml`): Windows NSIS +
  portable, macOS dmg, Linux AppImage; all unsigned (docs/tickets/tooling/desktop-code-signing.md).
- CI installers: manually dispatch `.github/workflows/desktop-build.yml` — native per-OS builds
  versioned `0.0.0-<short-sha>`, published as a public `build-<short-sha>` prerelease.
- App icon: `build/icon.png` (512², transparent) feeds the win/linux targets; `build/icon.icns` is
  committed pre-built (`iconutil` over Lanczos resizes) because electron-builder's png→icns
  converter flattens the 16/32 px entries onto white.
- tsc typechecks only (`emitDeclarationOnly`); esbuild bundles the four runtime files into `dist/`
  (`scripts/bundle.mjs`) so electron-builder never packs workspace-symlinked node_modules.

## Verifying

Pure logic (paths, config, progress model, protocol routing, content staleness) is unit-tested.
There is no committed end-to-end harness yet (docs/tickets/tooling/desktop-e2e-harness.md); the
wizard + pipeline + game boot flow was verified with ad-hoc Playwright `_electron` sessions against
the real game copy. Visual sign-off of the setup page and the in-shell game remains the user's.
