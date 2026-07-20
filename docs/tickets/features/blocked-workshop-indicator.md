# Show when a workshop is stalled on a full output slot

**Area:** packages/app, packages/render · **Origin:** feat/producer-unblocks-output review, 2026-07-20 · **Priority:** P3
**Needs user:** visual design and final sign-off — the indicator's look and placement need the user's eyes.

A workshop whose product slot is full stops producing until a unit is carried out. Since
`CARRY_CAPACITY` is 1 (`packages/sim/src/components/settler.ts`), a workshop in that state settles into
a long round trip per short production cycle: its stock row sits pinned at capacity while throughput
collapses to a fraction of nominal.

Before `feat/producer-unblocks-output` the symptom was legible by accident — the craftsman stood idle at
the door, which reads as "something is wrong here". Now the worker walks a delivery loop, so the
building looks busy while producing very little. Nothing in the details panel
(`packages/app/src/hud/details-panel/model/building.ts`, `StockRow`) says the workshop is
transport-starved rather than working normally.

Source basis: to be established. Check whether the original surfaces a "warehouse full" / "no transport"
state on the building panel or as a settler thought-bubble before inventing one — grep the readable
`.ini` text tables and observe the running original with a deliberately saturated warehouse.

## Scope

- Decide the signal from the original first (see above); if none exists, treat the indicator as a named
  approximation and say so.
- Surface "stalled: output slot full" on the building details panel, keyed off the same predicate the
  planner uses (`shelfBlockedOutput`) so the HUD and the sim can never disagree.
- Expose it through the existing snapshot/read seam — the HUD must not read live component stores.

## Verify

`npm test`, `npm run check`, `npm run build`. Acceptance scene under `packages/app/src/scenes/` showing a
saturated workshop, with a headless assertion on the flag and a human browser pass for the visual.
