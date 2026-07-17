# Deduplicate the scene-local pre-tick-0 settler spawn helpers

**Area:** app · **Origin:** child-hunger review battery, 2026-07-17 · **Priority:** P3

Four scenes carry a near-identical local helper wrapping `cellAnchorNode` + `systems.createSettler`
+ the null-throw: `family.ts` (`spawnAdult`), `berries.ts` (`spawnHungryForager`), `signposts.ts`,
and `scenes/children.ts` (`spawnYoung`). Each converts a whole tile to its anchor node, spawns with
`PRIMARY_TRIBE`/`HUMAN_PLAYER`, throws on an unknown job, then layers scene extras (needs, `Age`).
The dedupe-at-second-caller rule is well past due at the fourth copy.

## Scope

- One shared helper in `game/sandbox/place.ts` beside `spawnIdleSettler` (tile coords in, spawned
  entity out, options for tribe/owner/needs), with the scenes keeping only their scene-specific
  layering (`Age`, authored needs).
- Behavior-preserving: scene checks and goldens must not move.

## Verify

- `npm test` (scenes suite covers all four scenes headlessly).
