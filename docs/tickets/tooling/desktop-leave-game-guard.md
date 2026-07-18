# Make the leave-game confirmation only fire on an in-session URL

**Area:** desktop · **Origin:** bug-hunt review, 2026-07-17 (updated 2026-07-18) · **Priority:** P2

`openSetupPage` (`packages/desktop/src/window.ts`) guards the "Leave the running game?" dialog with
`isGameUrl(win.webContents.getURL())` (`packages/desktop/src/protocol.ts`), where `isGameUrl`
matches `app://game/index.html` with **any** query string. The installer-i18n change made the game
URL always carry `?lang=` (`gameUrlForLocale`), so the game's main-menu URL is now
`app://game/index.html?lang=<loc>` — which `isGameUrl` matches, so the dialog **still fires at the
main menu** where nothing is at risk. The destructive half (skipping the confirm mid-session) is
fixed: a scene/map session sets `window.location.search` to `?lang=…&map=…`/`?scene=…`
(`packages/app/src/entries/menu.ts`, `view/overlay.ts`), which `isGameUrl` also matches, so the
confirm now fires. What remains is the pointless main-menu prompt.

## Scope

- Confirm only when a game session would actually be lost: treat a game URL as in-session **only
  when it carries a world-selecting query** (`?map=`/`?scene=`), ignoring `?lang=` (always present)
  and the bare menu URL. `isGameUrl` (used for the origin/navigation intent) can stay as-is; the
  guard needs a narrower `isInGameSession(url)` predicate.
- Keep it pure and beside the protocol routing (already unit-tested per
  `packages/desktop/AGENTS.md`) and cover: menu URL (`?lang=` only) → no confirm, `?map=`/`?scene=`
  URLs → confirm, setup URL → no confirm.

The confirm dialog itself is already localized (`messages().dialogs`), so this is purely the
classification fix.

## Verify

`npm test` (new helper test), `npm run check`, `npm run build`. Manual pass: `npm run desktop`,
start a map, menu → Reinstall game content → dialog appears; from the main menu → no dialog.
