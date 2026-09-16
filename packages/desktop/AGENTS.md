# Desktop package contract

`packages/desktop` is the Electron host: one game window that serves `packages/app/dist` and the
converted content over the `app://` protocol. The root [`AGENTS.md`](../../AGENTS.md) applies.

## Boundaries

- The web app stays shell-agnostic and never imports desktop code; the shell exposes no preload
  script, no IPC, and no renderer bridge. Saves live in the page's IndexedDB like in a browser.
- Serve the app and the content through `app://` as static files: the app root first, then the
  content root, both laid out exactly as the app fetches them. Content and app are read-only
  resources; the shell's own code writes nothing, and the saves are the page's IndexedDB inside
  Electron's profile.
- `src/paths.ts` owns where the two trees are: the packaged app's `resources/app` and
  `resources/content` (the `extraResources` of `electron-builder.yml`), else the checkout's
  `packages/app/dist` and `content/` with `ON_CONTENT_DIR` honoured like Vite does. Do not duplicate
  that choice elsewhere.
- Keep `main.ts` and `window.ts` free of logic worth a unit test; routing, containment and path
  rules live in `protocol-routing.ts`, `static-files.ts` and `paths.ts`, which import nothing from
  `electron`.

## Build and verification

Root commands are documented in [`docs/DEVELOPMENT.md`](../../docs/DEVELOPMENT.md). Unit-test the
routing and path rules without Electron. `npm run test:desktop` exercises the built `app://` shell
and save/load across a relaunch on a temporary profile; prerequisites and scope are in
[`docs/TESTING.md`](../../docs/TESTING.md#desktop-boot-and-persistence). Packaging needs platform checks: verify that the window opens
on the main menu, a map starts, a save survives a relaunch, and the packaged app carries
`resources/content/ir.json` on the affected operating system.
