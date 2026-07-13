# Add a per-tick deliverable-sink memo to kill the O(stockpiles²) carrier path

**Area:** sim · **Origin:** sim-perf plan reconciliation, 2026-07-12 · **Priority:** P2

`nearestWorkplaceOutput` (`packages/sim/src/systems/agents/targets/stores/outputs.ts`) and
`workplaceOutputToHaul` (`packages/sim/src/systems/agents/economy/workshop/supply.ts`) call the
nested `nearestStoreFor` only as a **null-test** ("does ANY sink for this good exist?"), which makes
the carrier path `O(stockpiles²)` per tick. A per-tick `hasDeliverableSink(goodType)` memo replaces
the null-tests without touching any pick — provably winner-identical, so goldens must stay
byte-identical. `nearestGroundPile` (`agents/economy/haul-targets.ts`) already carries a *local*
per-good deliverability memo that proves the shape; hoist it to a shared per-tick structure.

This is the safe interim win pulled out of the wider ring-index migration
([economy-ring-index](economy-ring-index.md) is the follow-up).

## Scope

- A shared per-tick sink-availability memo in the AI planning context (built once per tick, or
  lazily per good with per-tick invalidation).
- Replace the null-test call sites in `targets/stores/outputs.ts` / `economy/workshop/supply.ts`;
  leave every actual nearest-pick untouched.

## Verify

- `npm test` — **goldens byte-identical** (a moved golden means the winner changed → stop and
  investigate).
- Before/after ms/tick at a few thousand settlers via a throwaway timer script over `dist/`
  (never `performance.now` in `src`).
- Determinism + perf review lenses on merge.
