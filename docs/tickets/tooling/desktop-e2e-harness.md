# Commit a desktop end-to-end harness

**Area:** desktop, tooling · **Priority:** P3

The shell's boot flow (the `app://` protocol serving the app and the content, the menu, a game, a
save surviving a relaunch) is verified only when a human runs the packaged app. `test:engines` boots
Electron too, but on the Vite dev server, so the shipped protocol handler and resource roots are
never exercised by a committed test.

## Scope

- A local-only e2e suite (like `test:content`: hard-fails without prerequisites, never runs in CI)
  driving the built shell with Playwright's `_electron`: the main menu lists maps with minimaps over
  `app://`, a map boots, a save written in one run is listed after a relaunch on the same profile,
  and a `bobs/` request spelled `app://bobs/<stem>.png` is served like the game-host spelling.
- Wire an npm script (e.g. `test:desktop`) and document it in `packages/desktop/AGENTS.md`.

## Gotcha: isolate Electron's profile

`electron.launch` must pass `--user-data-dir=<temp dir>`. `main.ts` gates startup on
`app.requestSingleInstanceLock()` and calls `app.quit()` when it loses - the process then exits 0
with no window and no output, which reads exactly like a crashed harness. Any other instance on the
same profile takes the lock and makes the harness exit without a window; the save-survives-relaunch
case needs the same temp profile for both launches.

## Verify

The suite passes locally against a converted `content/`; a deliberately broken protocol route fails it.
