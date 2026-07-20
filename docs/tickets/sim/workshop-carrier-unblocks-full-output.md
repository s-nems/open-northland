# Let a workshop-bound carrier unblock a full output slot before restocking inputs

**Area:** packages/sim · **Origin:** feat/producer-unblocks-output, 2026-07-20 · **Priority:** P3

`planProducer` now promotes the output run above the next input trip when the workshop's own output
slot is at the brim (`outputSlotsFull`, `systems/agents/economy/workshop/supply.ts`): a full shelf is
the one condition that only a departing unit can clear, so the craftsman ships one unit instead of
fetching more input it cannot consume.

`planWorkshopSupplier` — the sibling drive for a CARRIER bound to a recipe workshop
(`systems/agents/economy/workshop/index.ts`) — still runs the plain fetch-before-haul order, and its
fetch target is the input slot's full capacity rather than one cycle's worth. So a blocked workshop
staffed only by a carrier (no craftsman present to take the promoted run) keeps topping its input
slots up while production stands still, until the inputs also reach capacity and the haul finally
wins. The craftsman path masks this in practice, which is why it was left out of scope.

Source basis: the promotion mirrors observed original behavior (a workshop whose product slot is full
resumes as soon as one unit is carried out); the exact trip scheduling is not decoded, so the
fetch-vs-haul ordering for a workshop that is merely idle stays a named approximation either way.

## Scope

- In `planWorkshopSupplier`, apply the same `outputSlotsFull` promotion `planProducer` uses: probe the
  haulable output once, ship it when the shelf is what stopped the workshop, otherwise keep the
  existing restock-to-capacity-first order.
- Reuse `outputSlotsFull` and `startOutputHaul`; do not fork a second predicate.
- Pin it with a planner-level case in `packages/sim/test/economy/producer-supply/producer.cases.ts`
  beside the existing craftsman cases: a blocked twin mill with a bound carrier and an under-capacity
  input slot must produce an output pickup, not a fetch.

## Verify

`npm test`, `npm run check`, `npm run build`. Goldens must not move — no golden fixture staffs a
workshop with a bound carrier, so a moved hash means the promotion leaked into the craftsman path.
