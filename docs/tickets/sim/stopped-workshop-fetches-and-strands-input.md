# Stop ingredient errands when every workshop product is disabled

**Area:** sim · **Priority:** P2

An operator whose production counters disable every product still fetches ingredients for its workshop.
`planProducer` gets an empty `operatorRecipes` pool, then uses the merged whole-workshop recipe for its
final supply scan. The worker deposits the ingredient even though it cannot start a cycle. Workshop
inputs are excluded from other workers' fetch sources, so the last available ingredient can remain in
this stopped workshop while an enabled workshop reports no work.

## Reproduction

Use the synthetic producer-supply fixtures and a grass strip of eight visual cells:

- Place a stopped sawmill at `(0, 0)`, an enabled sawmill at `(7, 0)`, and a headquarters at `(2, 0)`
  holding exactly one wood.
- Bind one carpenter to each sawmill. Disable every product on the first carpenter with
  `pinProducts(sim, worker, [])`; enable plank on the second, with its wood-track experience at
  `PLANK_GATE_RAW_XP`. Add the fixture's woodcutter at `(6, 0)` to satisfy the existing unlock gate.
- Run 900 ticks with seed 1.

Verified result: the stopped sawmill holds one wood; the enabled sawmill holds zero plank and has no
`Production` component. An isolated planner pass also stamps a `SupplyRun` for the disabled carpenter
with the headquarters as its source. Positive control: the same setup with the stopped carpenter absent
produces plank from the sole wood within 900 ticks. These are implementation findings; original behavior
is unconfirmed.

## Scope

Distinguish an operator with no enabled craft product from a worker that needs the whole-shop supply
view. Keep advancing already committed cycles and useful output hauling, but prevent ingredient errands
for disabled products. Preserve the separate bound-carrier supply policy.

## Verify

- Add a planner regression beside the producer-supply tests: every product stopped yields no input
  `SupplyRun`; a selected product still fetches its missing input.
- Add the two-workshop finite-stock regression above. The stopped worker must leave the ingredient
  available, and the enabled worker must complete a plank cycle.
- Cover a finite product counter reaching zero after its last committed cycle starts: finish that
  cycle, then stop fetching for it.
- Run producer-supply, workshop-coordination and utility-self-service tests, then the required sim
  checks from `docs/TESTING.md`.
