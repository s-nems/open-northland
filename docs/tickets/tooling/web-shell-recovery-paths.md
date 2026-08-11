# Give the browser build a way back when its content routes are not being served

**Area:** web, app · **Priority:** P2

Two paths leave a web player in a game that cannot load, with nothing on screen that explains it or
leads anywhere.

A navigation straight to `/play/` runs no boot handshake. `packages/web/src/main.ts` registers the
service worker and waits for it to control the page, but only for the site root; nginx has no
`try_files` for content routes and the image answers them 404 by design. A bookmark, a shared link,
or Chrome's force-reload (which bypasses the worker for the page and its subresources) therefore
reaches the app uncontrolled, every content route 404s, and `fetchJsonOrNull` in
`packages/app/src/content/net.ts` degrades each miss to `null`, so the app boots the fallback catalog
and looks like it lost the converted data.

Nothing links back to the installer. `?setup` is the web counterpart of the desktop menu's "Reinstall
game content…", and no page references it (grep finds only the doc comment). A player whose content
broke, or who wants a fresh conversion after a mod update, has no route to it.

## Scope

- Have the app's web entry confirm it is controlled before its first content fetch, and present a
  readable surface (reload, or back to the installer) when it is not. The check belongs to the shell
  boundary, not to `packages/app`'s content loaders.
- Link `?setup` from somewhere a player can reach: the main menu, the boot-failure surface, or both.
- Non-goal: precaching the app build in the service worker, or offline play.

## Verify

`npm test`, `npm run check`, `npm run build`. Manual, against `npm run web:serve` with converted
content in the browser: load `/play/` directly in a fresh tab and force-reload it, and confirm each
ends in something readable that leads back to a working game.
