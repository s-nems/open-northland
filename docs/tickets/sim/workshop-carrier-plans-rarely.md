# A workshop-bound carrier plans for its own workshop only occasionally

**Area:** packages/sim · **Origin:** fix/food-export-conversion, 2026-07-20 · **Priority:** P2

A carrier bound to a recipe workshop runs `planWorkshopSupplier`
(`systems/agents/economy/workshop/index.ts`) — it restocks the input slots and hauls the finished output
out. Instrumenting the `magiczny_las` soak (seat 2's `work_bakery_00`, 20k ticks) showed that drive
reaching the bakery **73 times in 20 000 ticks**, and not once in the final 500. The bakery's own carrier
is also the settlement's porter, so the higher-priority general drives win nearly every replan.

The consequence was a bakery that filled its 20-loaf shelf and then drained at ~5 hauls per 20 000 ticks.
That symptom is now masked: the craftsman makes the run too (the `carrierSupplied` gate is gone), which
took every bakery off its cap. The underlying scheduling imbalance is untouched — a workshop whose
craftsmen are all seated or absent still depends on a carrier that rarely shows up.

## Scope

- Establish where the bound carrier actually goes instead: log which drive claims it per tick over a real
  soak (the general porter haul, the delivery rung, gossip, needs) before changing any ordering. The
  measurement is the deliverable; do not reorder rungs on a guess.
- If the general porter drive is starving the binding, decide the rule deliberately: a bound carrier that
  prefers its own workshop while it has work there, versus one that treats the binding as a home base.
  Name whichever is chosen as an approximation — trip scheduling is not decoded.
- Watch for the reverse failure: a carrier pinned to a quiet workshop while the settlement's ground piles
  go uncollected.

## Verify

`npm test`, `npm run check`, `npm run build`. Goldens must not move for a scheduling change that only
affects workshops staffing a carrier (no golden fixture does). Re-run a real-map soak and compare the
per-bakery shelf levels against this ticket's numbers.
