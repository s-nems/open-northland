# Deploy the web shell to opennorthland.org/game

**Area:** web · **Priority:** P2

`packages/web` builds a fully static site (`npm run web:site` → `packages/web/dist/site`), but
nothing publishes it yet. Wire the release flow so the same CI that builds desktop artifacts also
ships the site.

The layout, cache rules, and route ownership the host must respect are the deployment contract in
[`packages/web/AGENTS.md`](../../../packages/web/AGENTS.md); the permission to rehost the mod
archive is recorded in [`docs/LEGAL.md`](../../LEGAL.md). HTTPS is required - service workers and
OPFS do not run on plain HTTP.

## Scope

- A container or static-hosting job that runs `npm run web:site` and publishes `dist/site`.
- Upload the verified CnMod archive to `/cnmod/cnmod.zip`. A ~600 MB same-origin file rules out
  hosts with a per-file cap in the low hundreds of MB.
- Cache headers per the deployment contract: `sw.js` never immutable, hashed `play/assets/*` may be.

## Verify

`npm run web:site && npm run web:serve` locally, then the deployed URL: first visit shows the
installer, a converted copy plays, and a revisit goes straight into the game.
