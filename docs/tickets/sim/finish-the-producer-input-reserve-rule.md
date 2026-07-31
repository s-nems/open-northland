# Finish the producer input-reserve rule: the other fetch rungs, and the way back out

**Area:** sim (settlers/drives/economy) · **Priority:** P2

`mayFetchGoodFrom` (`systems/settlers/drives/economy/store-policy.ts`) stops a consumer from lifting a good
that the holder's own recipe consumes. Only `nearestMissingInputSource` consults it, and nothing
balances an input slot once it is full, so two halves of the rule are still missing.

## 1. The other fetch rungs ignore it

`nearestStoreHolding` (`systems/settlers/targets/stores/stock.ts`) accepts any positioned stockpile
that holds the good, so three rungs still strip protected reserves:

- `settlers/drives/economy/builder.ts` — a builder fetching construction material;
- `settlers/drives/equip-order.ts` — an equip errand;
- `settlers/planner/assistant-grants.ts` — a granted item.

Real content pays every construction bill in wood/stone/brick, and `work_joinery_01`,
`work_pottery_01` and `work_smithy_01` all hold wood as a recipe input, so "a builder emptied the
joinery's wood" is the same complaint arriving from another rung.

## 2. Inputs go in to the brim and never come back out

The delivery side deliberately fills consumers: `toNearbyRecipeConsumer`
(`settlers/drives/economy/delivery-rules.ts`) routes a utility carrier's output to the nearest
recipe consumer before storage, `canStoreGood` accepts any
consumer as a sink, and a bound workshop carrier tops each input slot to full `stockCapacity`. With
the fetch side now closed, a slot that fills can only be drained by production. Projected from the
slot capacities on the AI's own plan, that parks roughly 15 wood + 15 iron per smithy, 10 + 10 in
the joinery and 10 mud + 10 wood in the pottery, and the visible failure would be "one shop sits on
a full slot while its sibling shows 0 and idles", with no panel text explaining it.

Not yet observed in that shape: a 30 000-tick `magiczny_las` run has the joinery holding 1-5 wood and
NO iron while the smithies hold 0-3, so nothing is hoarded there today - see
`craft-selection-holds-an-operator-for-a-seat-it-cannot-use.md`, which is why that joinery idles.
Re-measure before treating the parking figures as the live state.

## Scope

- Apply `mayFetchGoodFrom` inside `nearestStoreHolding`'s accept, or move the predicate beside
  `canStoreGood` and share it. Decide and record whether equip/grant errands are exempt.
- Give the reserve a way back out: cap a top-up when a sibling consumer of the same good is at zero,
  or add a rebalance rung.
- Consider whether homes and the barracks should be protected too. `work_coin_mint` consumes
  `food_simple`, `mead`, `shoes` and weapons, and `work_druid_01` consumes `coin`, so a mint
  operator may empty a family larder the eat rung already treats as private
  (`settlers/targets/food.ts`).

## Notes

`logicstock <good> <capacity> <flag>` may carry the answer directly: across all 360 IR slots the
third int is 1 exactly on the consumed-here slots. The extractor currently names it `initial` and
`command/placement.ts` applies it as a starting fill. Keying on the flag alone would break the
sandbox catalog (all zeros), so a flag-when-present / derive-otherwise rule is the honest shape —
and the extractor's naming deserves its own ticket.

## Verify

A builder short of wood walks past a workshop's wood reserve to storage; an idle consumer at zero
can still be fed while a sibling holds a full slot; the existing builder, equip, grant and
producer-supply suites pass. `npm test`, `npm run check`, `npm run build`. Golden state hashes must
not move.
