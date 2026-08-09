# Deploy the web shell to opennorthland.org/game

**Area:** web · **Priority:** P2

`packages/web` builds a fully static site (`npm run web:site` → `packages/web/dist/site`), but
nothing publishes it yet. Wire the release flow so the same CI that builds desktop artifacts also
ships the site.

The layout the server must provide (mirrored locally by `packages/web/scripts/serve.mjs`):

- `/game/` serves `packages/web/dist/site` (installer page, `sw.js`, `pipeline-worker.js`, and the
  app under `/game/play/` - the `/game/play` base is baked into the app build);
- `/cnmod/cnmod.zip` hosts the CulturesNation archive on the same origin (the installer downloads it
  without CORS; mod authors approve rehosting);
- HTTPS is required - service workers and OPFS do not run on plain HTTP.

## Scope

- A container or static-hosting job that runs `npm run web:site` and publishes `dist/site`.
- Upload the verified CnMod archive to `/cnmod/cnmod.zip`.
- Cache headers: `sw.js` must not be served immutable; hashed `play/assets/*` may be.

## Verify

`npm run web:site && npm run web:serve` locally, then the deployed URL: first visit shows the
installer, a converted copy plays, and a revisit goes straight into the game.
