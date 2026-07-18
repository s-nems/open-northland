# Cut the AI seat's per-decision O(entities) rescans

**Area:** sim · **Origin:** engine review of the AI-player scaffold 2026-07-18 · **Priority:** P3

The strategic AI's per-seat decision is within budget today (one seat fires per tick — players
`0..15` land on distinct `player % 24` stagger slots — so at most one seat pays it per tick), but a
single decision does several full-population passes. On a large map (256², thousands of entities) one
decision tick can spike.

Two hotspots:

- `packages/sim/src/systems/ai-player/shared.ts` — `ownedBuildings` / `ownedSettlers` scan every
  player's entities and filter to one owner, and are recomputed by each module within one seat's
  decision (`headquartersOf`, build-order, workforce step 3, population, signpost all call one or
  both). Fix: memoise `ownedBuildings`/`ownedSettlers` per decision (pass a per-seat cache through the
  module context), or keep an owner-indexed entity list.
- `packages/sim/src/systems/ai-player/signpost-coverage.ts` `nextSignpostTarget` — nests
  `buildings.some(withinNodeRadius…)` inside the ring×target walk (O(rings×targets ×
  buildingsOfSeat)), and it runs twice per decision (workforce `scoutWanted` check + the signpost
  module). Self-bounded by `MAX_LATTICE_RING` and the small opening build order today; grows with a
  seat's building count under expansion. Fix: a spatial bucket over the seat's buildings, and/or
  compute `nextSignpostTarget` once per decision and share it.

Neither is nested-per-entity (both are linear per decision), so this is a headroom ticket, not a
live regression.

## Verify

- Bench a decision tick on a large real map before/after; AI module tests stay green;
  `npm test`, `npm run check`, `npm run build`.
