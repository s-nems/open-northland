# Desktop package contract

`packages/desktop` is the Electron host: one game window that serves `packages/app/dist` and the
converted content over the `app://` protocol. The root [`AGENTS.md`](../../AGENTS.md) applies.

## Boundaries

- The web app stays shell-agnostic and never imports desktop code. The shell owns its window: it
  opens fullscreen on a packaged profile's first launch and reopens in the mode, bounds and display it
  closed with (`src/window/state.ts`). Development always starts in a normal window, preserving bounds;
  `ON_DESKTOP_RESTORE_WINDOW=1` opts into the packaged startup behavior for explicit window-mode checks.
  Its preload exposes only `window.desktop.fullscreen` (read, set,
  subscribe), `window.desktop.originalGame` (status, pick a folder), `window.desktop.maps`
  (pick/drop/cancel a local file or folder, list records, read a map snapshot, file or retained source,
  commit maps and source together) and `window.desktop.faults` (pending faults, clear by id, build
  versions, how the previous run ended), which the app feature-detects. Keep that bridge narrow,
  validate every IPC argument and sender, and keep sandbox and context isolation on.
  Saves live in the page's IndexedDB like in a browser. A page or mail link the game opens goes to
  the system browser or mail client, never a second window.
- Serve the app and generated content through `app://` as read-only static files. Installed maps
  use the snapshot IPC: the app's map-source store serves their logical `/maps/` URLs from those
  bytes. The shell owns both installed records and immutable file generations in the profile's
  `maps/` directory (`src/maps/store.ts`). One atomic manifest replacement publishes a complete pack;
  failed writes preserve the previous manifest. Reads and commits share one queue, and cleanup
  follows publication. Original input paths are metadata; retained bytes use numeric file slots in
  immutable generations. Native picks enforce shared import limits before reading and refuse symlinks.
  The app owns the record schema; the shell validates IPC shapes, paths, revisions and per-request sizes.
  There is no aggregate desktop storage budget.
- The shell writes only window state, `original-game.json`, installed-map storage, recorded
  faults and its run file in its profile; Electron's crash reporter keeps local minidumps. Saves
  remain in the page's IndexedDB.
- `src/faults/` records renderer crashes and hangs, GPU process deaths and main-process errors as one
  JSON file each in the profile's `faults/`, the newest 20 kept, home directory redacted, until the
  page clears them. A crashed page reloads the start page; a second crash within a minute
  asks the player to restart or quit instead. Main-process errors keep Electron's own handling.
- `src/faults/shell-run.ts` keeps `shell-run.json` while the shell runs and records its quit there.
  At the next start it tells the page how that run ended: an ordinary quit, a minidump newer than the
  run's start and its last child-process death plus a grace (a native crash), a system shutdown or a
  sleep it never woke from (no unclean-exit report for a page that stopped with a quit, a shutdown or
  a sleep), or none of these. Dumps are never uploaded; the start deletes them once judged.
- A packaged build (or a run with `ON_ORIGINAL_GAME_CHECK=1`) requires an installed original game
  through `src/original-game/`. Before the window opens, a profile without `original-game.json`
  runs detection (or checks only the folder `ON_ORIGINAL_GAME_DIR` names) and records a hit. The
  window opens either way; while the record is missing, the app shows its gate screen, whose pick
  button opens the shell's folder dialog. `src/original-game/` imports nothing from `electron`;
  `window/create.ts` binds its handlers to IPC and the dialog.
- `src/paths.ts` owns where the trees are: the packaged app's `resources/app` and
  `resources/content` (the `extraResources` of `electron-builder.yml`), else the checkout's
  `packages/app/dist` and `content/` with `ON_CONTENT_DIR` honoured like Vite does, and the
  profile's `maps/` for installed maps and `faults/` for recorded faults. Do not duplicate that choice elsewhere.
- Keep `main.ts` and `window/create.ts` free of logic worth a unit test; routing, containment and
  path rules live in `protocol/routing.ts`, `protocol/static-files.ts`, `protocol/file-response.ts`,
  `maps/installed.ts`, `maps/store.ts`, `faults/store.ts`, `faults/redact.ts`, `faults/hung-stack.ts`,
  `faults/reload-guard.ts`, `faults/shell-run.ts`, `paths.ts`, `window/state.ts` and
  `window/control.ts`, which import nothing from `electron`.

## Layout

- `src/` root: the bundle entries `main.ts` and `preload.ts`, `paths.ts`, `gpu-info.ts`,
  `application-menu.ts`.
- `src/maps/`: installed-map IPC channels, storage and native local-map input.
- `src/protocol/`: the `app://` scheme, its routing and static-file responses.
- `src/window/`: the game window, its saved state, fullscreen control and leave prompt.
- `src/original-game/`: original-game detection, its record and IPC channels.
- `src/faults/`: fault recording, its store and IPC channels.

Unit tests mirror `src/` under `test/`; `test-e2e/` drives the built shell.

## Build and verification

`resources/icon.png`, `resources/icon.ico`, `resources/icon.icns` and the badged `resources/icon-*`
variants are generated by `npm run brand` (`tools/brand`), never edited by hand: electron-builder's
own downscaling drops transparency on the small sizes and the prebuilt files carry the flat emblem there.

`resources/portable-splash.bmp` is also generated by `npm run brand`, from the existing logo. The
Windows portable launcher shows it while extracting, before Electron starts; verify its appearance
and dismissal on Windows. Its English message is static because app preferences are not yet loaded.
The portable exe's icon is the packaged app's icon, so `electron-builder-portable.yml` packages it in
a second pass; a release runs both configs.

Root commands are documented in [`docs/DEVELOPMENT.md`](../../docs/DEVELOPMENT.md). Unit-test the
routing and path rules without Electron. `npm run test:desktop` exercises the built `app://` shell
and save/load across a relaunch on a temporary profile; prerequisites and scope are in
[`docs/TESTING.md`](../../docs/TESTING.md#desktop-boot-and-persistence). Packaging needs platform checks: verify that the window opens
on the main menu, a map starts, a save survives a relaunch, and the packaged app carries
`resources/content/ir.json` on the affected operating system.
