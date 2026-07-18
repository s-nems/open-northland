# Audio cue for a razed building

**Area:** audio · **Origin:** building-combat-damage slice, 2026-07-18 · **Priority:** P3

A building coming down (combat raze or player demolish — both emit `buildingDestroyed`, now carrying
`buildingType`) plays a render collapse: the body sinks into the ground with its lowest rows clipped
(`packages/render/src/gpu/overlays/collapse-layer.ts`). **It is still silent** — no demolition SFX
and no "you lost a building" stinger.

## Scope

- A demolition/collapse SFX at the event's `at`, and optionally a non-spatial "you lost a building"
  stinger for the local player when `player === humanPlayer` (the building twin of the settler death
  stinger). Source basis: pick from the extracted sound bank; if no faithful collapse SFX exists, name
  the substitute. **Audio needs the user's sign-off** (`?sounds` gallery / `?scene=siege` by ear).

## Verify

- `npm test` — the event fires from both paths (covered by
  `packages/sim/test/conflict/attack-buildings.test.ts` and
  `packages/sim/test/systems/command-system/buildings.cases.ts`); this adds an audio consumer only.
- `?scene=siege` — a razed HQ/tower falls with a thud (human ears).
