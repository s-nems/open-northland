# Wire building-assigned gatherers: no flag, the building is the delivery target

**Area:** sim + app · **Origin:** gathering-economy plan reconciliation, 2026-07-12 · **Priority:** P2

The original's gatherer assigned to a building delivers into that building — no work flag. Our
code only exercises the free-gatherer path: map gatherers spawn free (→ flag), and the
"assigned to a building → no flag, deliver to the building (the building IS the flag)" case is not
wired anywhere.

## Scope

- Let a gatherer bound to a workplace skip flag placement and deliver its haul to the bound
  building. The adjacent pattern is the bound-carrier haul-out seam: `boundProducerOutputToHaul`
  in `packages/sim/src/systems/agents/economy/haul-targets.ts` (consumed by
  `systems/agents/economy/hauling.ts`), with the binding itself the `JobAssignment` component
  (`workplace: Entity`, `packages/sim/src/components/settler.ts`).
- Exercise it: a scene or headless test where a building-assigned collector fells/delivers into
  its building.

## Verify

- `npm test` — existing goldens byte-identical (new path is opt-in by assignment).
- Headless: assigned gatherer produces no flag entity and the building's stock rises.
