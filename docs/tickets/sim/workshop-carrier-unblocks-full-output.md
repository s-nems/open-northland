# Let a workshop-bound carrier unblock a full output slot before restocking inputs

**Area:** packages/sim · **Origin:** feat/producer-unblocks-output, 2026-07-20 · **Priority:** P2

`planProducer` promotes the output run above the next input trip when a product's slot is at the brim
with its inputs on hand (`shelfBlockedOutput`, `systems/economy/production/cycles.ts`): a full shelf is
the one stall no fetch can clear, so the craftsman ships that good instead of fetching input it cannot
consume.

`planWorkshopSupplier` — the sibling drive for a CARRIER bound to a recipe workshop
(`systems/agents/economy/workshop/index.ts`) — still runs the plain fetch-before-haul order, and its
fetch target is the input slot's full capacity rather than one cycle's worth. So a blocked workshop
whose craftsmen are all seated or absent keeps topping input slots up while production stands still.

This is the more source-faithful half, not the leftover. `Cultures 8th Wonder/Data/logic/jobtypes.ini`
grants the pickup/pileup atomics (22/23) to the builder, collector, fisher and carrier trades — not to
a baker — and `work_bakery_00` staffs a carrier slot (`jobType 24`) beside its baker. So the original
most likely routes the unblocking trip through the bound carrier, and the craftsman doing it (the
pre-existing self-service model) is the approximation. Fixing this side lets the craftsman promotion
become the fallback it should be rather than the primary path.

## Scope

- In `planWorkshopSupplier`, consult `shelfBlockedOutput` before the restock scan: when it names a good,
  ship that good; otherwise keep the existing restock-to-capacity-first order.
- Reuse `shelfBlockedOutput` and `startOutputHaul`; do not fork a second predicate.
- Pin it with a planner-level case in `packages/sim/test/economy/producer-supply/producer.cases.ts`
  beside the existing craftsman cases: a blocked `BAKEHOUSE`/`TWIN_MILL` with a bound carrier and an
  under-capacity input slot must produce an output pickup, not a fetch. Verify the case fails without
  the change (the craftsman rung must not mask it — give the workshop no craftsman).

## Verify

`npm test`, `npm run check`, `npm run build`. Goldens must not move — no golden fixture staffs a
workshop with a bound carrier, so a moved hash means the change leaked into the craftsman path.
