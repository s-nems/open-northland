# A freed producer fetches inputs for products its own rotation cannot make

**Area:** sim (settlers/drives/economy) · **Origin:** review of the craft-seat gate fix, 2026-07-27 · **Priority:** P2

`planProducer` (`systems/settlers/drives/economy/workshop/index.ts`) hands `nearestMissingInputSource`
the type's MERGED recipe (`mergedRecipeOf`: inputs summed over every product). That scan walks the
merged inputs in content order and takes the FIRST one the workplace is short of, so a worker whose
`craftablePool` names a single ware still tops up every other product's input before its own.

Measured in the sim fixture (a `food_simple`-pinned carpenter at an empty two-product bakehouse, both
goods in the HQ): it carries wood on the first trip and wheat only on the second. Merged fetch orders
in real content:

| workplace | merged input order |
|---|---|
| `work_coin_mint` | wood:1 iron:6 gold:7 food_simple:1 shoes:1 armor_leather:1 bow_long:1 sword_shord:1 mead:1 |
| `work_smithy_01` | wood:4 iron:8 spear_wooden:1 |
| `work_joinery_01` | wood:4 iron:1 |

A coin-pinned minter hauls six iron, a sword, shoes, armour and a bow into the mint before its own
gold. The scan predates the seat-gate fix (an empty shop always reached it), but a restricted operator
now reaches it routinely, so this is that worker's normal path rather than a corner case.

## Scope

Narrow the recipe `planProducer` hands the input scan to the operator's own pool
(`craftablePool`). `planWorkshopSupplier` stays on the merged recipe: a bound carrier serves every
operator. Decide deliberately whether the OUTPUT haul stays merged (a restricted craftsman should
still be able to clear another ware off a full shelf) and keep the per-tick allocation bounded.

## Verify

- A pinned operator at an empty two-product workshop fetches ITS input on the first trip; an unpinned
  one is unchanged (its pool is every product, so its merged view is the same).
- `npm test`. Golden state hashes must not move.
