# Populate the goods `equip` lane from extracted data

**Area:** pipeline · **Priority:** P2

The sim's equipment component axis exists, but the extractor does not populate `equip`
(`packages/data/src/schema/economy/goods.ts`) on the real `ir.json`.

Interim: the app overlays the clean-room classification by good slug at load
(`withEquipClass` in `packages/app/src/content/real-content.ts`), so the equip window works on real
content today. The overlay also carries every other `EquipClass` field (tool bonuses, `uses`,
`restorePct`, the amulets' combat and walk effects) the sim's equipment effects run on - values no
readable source carries (fixed in the original), so extraction can only ever supply `category`/`wears`. The
landing commit must therefore FIELD-MERGE: extracted classification wins, but the balance fields
stay overlaid wherever the shipped `equip` lacks them. A wholesale "extracted wins" (today's
`withEquipClass` defers entirely when `good.equip` ships) would silently strip every worn effect on
real content.

**Source basis:** weapons/armour/amulets don't wear - their `equip.wears` is false (the sim's
`packages/sim/src/components/equipment.ts` already pins this).

## Scope

- Populate the `equip` lane from the readable data, field-merged with the overlay's balance fields.

## Verify

- `npm test`; a real pipeline run against the local mod (extraction changed).
- The generated `ir.json` carries `equip` on the equippable goods, and the equip window, draught
  effects and the `amulets` scene's real-content test still work.
