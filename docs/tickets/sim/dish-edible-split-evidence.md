# Pin the simple/extra split for the five non-candy dishes

**Area:** packages/sim · **Origin:** fix/food-export-conversion, 2026-07-20 · **Priority:** P3

`EDIBLE_FORM_BY_DISH` (`systems/readviews/food.ts`) maps each dish good to the edible it becomes when a
carrier lifts it out of the house that cooked it. The mapping's *existence* is well evidenced (a dish has
a `logicstock` slot only in its own producing house; `food_simple`/`food_extra` are slotted everywhere and
produced by nothing — pinned by `packages/app/test/content/dish-goods.test.ts`).

The **split** is not evenly evidenced:

- `candy` → `food_extra` is direct: `text/pol/strings/gameobjects/goods.ini` gives good 17 and good 20 the
  same display name ("Ciastko"/"Ciastka"), and the eat slots are named for the same pair
  (`..._eat_slot_food` = atomic 10, `..._eat_slot_candy` = atomic 11).
- `fruit`, `bread`, `meat`, `fish`, `sausage` → `food_simple` is **by elimination**: good 16 carries the
  generic name ("Żywność") and nothing contradicts it. No readable rule file states the split.

The risk is concentrated in the processed dishes. `sausage` is made from `meat` and `candy` from
flour + honey; if the original treats the upgraded dish as the luxury food, `sausage` (and possibly
`meat`) belongs on `food_extra` and our mapping starves the higher home levels of the extra they want
while over-supplying simple. Homes stock BOTH forms (`home level 00`–`04`, `logicstock 16` and `17`,
flag 1), so the two are not interchangeable to the consumer.

## Scope

- Find a source that states the binding rather than implying it: the eat-slot atomic table in the
  tribetypes `setatomic` block, the `.cif`-encoded help/strings for goods 16/17, or byte-level evidence
  from the engine's good table. Document what was checked even if it comes back empty.
- If evidence lands, correct `EDIBLE_FORM_BY_DISH` and replace the "by elimination" wording in its
  source-basis comment with the real basis.
- If no evidence exists, observe the original: feed a settlement only sausage and watch whether a
  level-03+ home's `food_extra` slot fills.

## Verify

`npm test`, `npm run check`. A changed mapping moves no golden (no golden fixture stocks a dish), so add
a case to `packages/sim/test/economy/dish-export.test.ts` for whichever dish changes form.
