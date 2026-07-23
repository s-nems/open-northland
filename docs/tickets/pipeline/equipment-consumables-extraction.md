# Populate the goods `equip` lane and bind icons for the iconless equippables

**Area:** pipeline · **Priority:** P2

The sim's equipment component axis exists, but the extractor does not populate `equip`
(`packages/data/src/schema/economy/goods.ts`) on the real `ir.json`, and the potion/amulet goods
have no icons — their `landscapeType` has no `good piles all` record (the same gap leaves `fruit`
iconless).

Interim: the app overlays the clean-room classification by good slug at load
(`withEquipClass` in `packages/app/src/content/real-content.ts`), so the equip window works on real
content today. Extracted data wins over the overlay once this lands (the overlay keeps a
ships-with-`equip` good untouched); remove the overlay in the landing commit if the extraction
covers every equippable.

**Source basis:** weapons/armour/amulets don't wear — their `equip.wears` is false (the sim's
`packages/sim/src/components/equipment.ts` already pins this).

## Scope

- Populate the `equip` lane from the readable data.
- Bind icons for the iconless equippables (potions ×6, amulets ×6, fruit) — nearest-extractor
  mirror, not hand-built art.

## Verify

- `npm test`; a real pipeline run against the owned game copy (extraction changed).
- The generated `ir.json` carries `equip` on the equippable goods and icon bindings for the
  previously iconless ones.
