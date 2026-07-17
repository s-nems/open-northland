# Fix the leave-game confirmation's URL check

**Area:** desktop · **Origin:** bug-hunt review, 2026-07-17 · **Priority:** P2

`openSetupPage` (`packages/desktop/src/main.ts:113`) guards the "Leave the running game?" dialog
with `win.webContents.getURL() === GAME_URL` (strict equality against `app://game/index.html`).
But the web app navigates into a scene/map by setting the query string —
`packages/app/src/entries/menu.ts:231` (`window.location.search = targetSearch(...)`) and
`view/overlay.ts:62` — so during an actual game session the URL is `app://game/index.html?...` and
the equality fails. Result: menu → "Reinstall game content…" mid-session loads the setup page with
**no confirmation**, destroying the running session (there is no saving yet — exactly what the
dialog exists to protect). Inversely, at the main menu (URL exactly `GAME_URL`, nothing to lose)
the user gets a pointless confirmation.

## Scope

- Replace the equality with intent: confirm when a game session would be lost. Minimal fix: treat
  any `GAME_URL`-prefixed URL **with a world-selecting query** (`?map=`/`?scene=`) as in-session,
  and skip the dialog on the bare menu URL. A plain `startsWith(GAME_URL)` check fixes the
  destructive half but keeps the pointless menu prompt — prefer the query-aware version since both
  halves are known.
- The URL-classification is pure — extract it as a testable helper beside the protocol routing
  (which is already unit-tested per `packages/desktop/AGENTS.md`) and cover: bare menu URL → no
  confirm, `?map=`/`?scene=` URLs → confirm, setup URL → no confirm.

## Verify

`npm test` (new helper test), `npm run check`, `npm run build`. Manual pass: `npm run desktop`,
start a map, menu → Reinstall game content → dialog appears; from the main menu → no dialog.
