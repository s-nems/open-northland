# Exercise building-assigned gatherers with a headless test / scene

**Area:** sim + app · **Origin:** gathering-economy plan reconciliation, 2026-07-12; mechanism landed 2026-07-15 · **Priority:** P2

The mechanism is now wired: a gatherer bound to a workplace (`JobAssignment`, no `WorkFlag`) skips flag
placement and banks its harvest into the bound building — the building IS its flag. What landed:

- `assignWorker` drops the auto-planted work flag when it binds a harvest job
  (`packages/sim/src/systems/orders/work.ts`), so a hand-assigned gatherer carries no flag.
- The gatherer is routed to the gather drive, not the producer loop: `aiSystem` skips the
  bound-workplace producer branch for a harvest job (`packages/sim/src/systems/agents/ai.ts`), and a
  gatherer job is excluded from a workplace's operators so it never satisfies the production presence gate
  (`operatorJobsOf` in `packages/sim/src/systems/stores/workplace.ts`).
- Delivery routes the harvest to the building via the existing `deliveryTargetFor` cases: a recipe input
  → the workshop (case 1), a storage sink → the warehouse (case 3b)
  (`packages/sim/src/systems/agents/economy/routing.ts`).
- Sandbox content gives the rebased gatherer worker-slot jobs (collector/hunter/fisher) the collector's
  harvest atomics so an assigned collector actually gathers
  (`packages/app/src/game/sandbox/content/catalog/jobs.ts`).

## Remaining scope

- Add a headless test (or a small acceptance scene with a machine check) that binds a collector to a
  building and asserts: it plants **no** flag entity, and the bound building's stock rises from the
  collector's deliveries. Cover both target kinds — a warehouse (storage sink) and a workshop whose
  recipe input the collector harvests.
- Keep the existing goldens byte-identical (the new path is opt-in by assignment; unowned economy
  fixtures are untouched).

## Verify

- `npm test` — the new assertion is green; existing goldens unchanged.
- Optional browser pass: assign a collector to a warehouse via the "przydziel miejsce pracy" button and
  watch its harvest bank into the building (human eyes on the motion).
