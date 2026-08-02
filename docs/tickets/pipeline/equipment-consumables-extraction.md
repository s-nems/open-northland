# Populate the goods `equip` lane and bind icons for the iconless equippables

**Area:** pipeline · **Priority:** P2

The sim's equipment component axis exists, but the extractor does not populate `equip`
(`packages/data/src/schema/economy/goods.ts`) on the real `ir.json`, and the potion/amulet goods
have no icons - their `landscapeType` has no `good piles all` record (the same gap leaves `fruit`
iconless).

Interim: the app overlays the clean-room classification by good slug at load
(`withEquipClass` in `packages/app/src/content/real-content.ts`), so the equip window works on real
content today. The overlay now ALSO carries the effect/wear balance fields (`speedBonusPct`,
`productionBonusPct`, `uses`, `restorePct`) the sim's equipment effects run on - values no readable
source carries (engine-hardcoded), so extraction can only ever supply `category`/`wears`. The
landing commit must therefore FIELD-MERGE: extracted classification wins, but the balance fields
stay overlaid wherever the shipped `equip` lacks them. A wholesale "extracted wins" (today's
`withEquipClass` defers entirely when `good.equip` ships) would silently strip every worn effect on
real content.

**Source basis:** weapons/armour/amulets don't wear - their `equip.wears` is false (the sim's
`packages/sim/src/components/equipment.ts` already pins this).

## Scope

- Populate the `equip` lane from the readable data.
- Bind icons for the iconless equippables (potions ×6, amulets ×6, fruit) - nearest-extractor
  mirror, not hand-built art.

## Verify

- `npm test`; a real pipeline run against the owned game copy (extraction changed).
- The generated `ir.json` carries `equip` on the equippable goods and icon bindings for the
  previously iconless ones.
