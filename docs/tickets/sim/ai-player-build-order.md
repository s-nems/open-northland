# Give the AI player a data-driven build module: opening build order + placement

**Area:** sim (+ content schema) · **Origin:** enemy-AI design close-out 2026-07-17 · **Priority:** P2
**Needs user:** the concrete opening build order and build priorities come from the user's own
plan — collect it before executing; this ticket fixes only the executor shape.
**Blocked by:** docs/tickets/sim/ai-player-scaffold.md

The HouseBuild module of the HAI-style AI player (module list pinned by the original's
`HAI_DisableHouseBuild`/`HAI_DisableGuideBuild` toggles; internals are a named genre-convention
approximation). Genre consensus (Widelands "basic economy", Petra `startingStrategy`, KaM classic
AI, StarCraft/AoE2 opening books): a small authored opening list executes first, because generic
demand logic misbehaves on an empty map; a build order is *data* — an ordered list of building ids
with counts — interpreted by a generic executor, never code.

## Scope

1. A validated build-order content shape (building ids + counts, per AI profile) under `content/`
   IR — populated from the user's plan, not invented here.
2. Executor inside the scaffold's module seam: next unmet entry → feasibility check (resources,
   space) → pick a site → `placeBuilding` → `assignBuilder`. Repair rules: re-place a destroyed or
   failed entry instead of abandoning the list; stall (don't skip) while resources are short.
3. Placement scoring: candidate half-cell sites near the seat's start/territory, scored by simple
   named criteria (distance to home, terrain fit via existing footprint checks). Keep it cheap —
   candidate enumeration must not scan the whole map per decision.
4. When the list is exhausted, the module goes quiet; demand-driven steady state is
   `ai-player-workforce.md`'s job.

## Verify

- Headless scenario: an AI seat on a real map executes its opening list — buildings appear in
  order, construction completes, same seed twice → identical hashes.
- Acceptance scene (`packages/app/src/scenes/`): an AI-only game the user can watch play itself —
  the point of the feature is observing games run without hand-testing the build order.
- `npm test`, `npm run check`, `npm run build`; `npm run test:content` when local content exists.
