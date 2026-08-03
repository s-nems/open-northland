# Desktop shell swallows the credits screen's external links

**Area:** tooling · **Priority:** P3
**Needs user:** run the packaged shell for the final click-through.

The redesigned menu's credits screen (`packages/app/src/entries/main-menu/credits.ts`) opens its
repo, issue-tracker and CulturesNation links as `target="_blank"` anchors. In the Electron shell,
`packages/desktop/src/window.ts` denies every window-open request
(`setWindowOpenHandler(() => ({ action: 'deny' }))`) and `will-navigate` blocks non-app URLs, so
all three links silently do nothing in the desktop build. The browser build is unaffected.

## Scope

- In the window-open handler, pass `https:` URLs that are not `app://` pages to
  `shell.openExternal(url)` while still returning `action: 'deny'`.
- Keep the app shell-agnostic: no change in `packages/app`.

## Verify

- Unit-test the URL decision if it is extracted as a pure helper.
- Platform check: run the packaged shell, open Twórcy, confirm all three links open in the system
  browser and no Electron window appears.
