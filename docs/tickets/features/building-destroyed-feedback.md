# Render/audio cue for a razed building

**Area:** render + audio · **Origin:** building-combat-damage slice, 2026-07-18 · **Priority:** P3

Warriors can now raze enemy buildings: when a building's `Health` hits 0 the `cleanupSystem` reaps it
and emits a new `buildingDestroyed` SimEvent (`packages/sim/src/core/events.ts` —
`{ entity, player, at }`, the structure twin of `settlerDied`). **Nothing consumes it yet.** The
building simply vanishes from the snapshot (the sprite pool culls the missing entity via
`reconcileSprites`), with no collapse effect and no sound — a base falls silently.

## Scope

- **Render:** on `buildingDestroyed`, play a one-shot rubble/dust puff at `at` (an `effects-layer`
  cue like the `bones` corpse marker), so a razed structure reads as destroyed rather than blinking out.
- **Audio:** a demolition/collapse SFX at `at`, and optionally a non-spatial "you lost a building"
  stinger for the local player when `player === humanPlayer` (the building twin of the settler death
  stinger). Source basis: pick from the extracted sound bank; if no faithful collapse SFX exists, name
  the substitute. **Audio needs the user's sign-off** (`?sounds` gallery / `?scene=siege` by ear).

## Verify

- `npm test` — the event already fires (covered by `packages/sim/test/conflict/attack-buildings.test.ts`);
  this adds render/audio consumers only.
- `?scene=siege` — a razed HQ/tower collapses with dust + a thud (human eyes/ears).
