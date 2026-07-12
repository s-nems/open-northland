# Split view/game-view.ts by concern

**Area:** packages/app · **Origin:** code review of feat/fog-of-war, 2026-07-12 (pre-existing growth,
amplified by the fog round)

`packages/app/src/view/game-view.ts` is ~650 lines: deps/typing, the placement-overlay band probe,
fog predicates + presentation filters, the pile-tooltip hit cache, HUD/minimap/admin mounts, and the
fixed-timestep frame loop all live in one file — well past the ~300-line split rule.

## Scope

Behavior-preserving split into a `view/game-view/` feature folder (index barrel keeps the
`startGameView` import path stable). Natural seams observed during the fog work:

- the placement overlay source + `canPlaceAt` fog gate (one lockstep unit);
- the fog presentation glue (`frameFog`, predicates, event/plot/badge filters);
- the hover-tooltip pile cache;
- the frame loop itself.

## Verify

`npm test`, `npm run check`, `npm run build`; boot `?map=` and `?scene=fog` — no console errors,
placement/tooltip/fog behavior unchanged.
