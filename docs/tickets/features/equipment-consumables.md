# Implement the consume/drink drive for potions, mead, and equipment slots

**Area:** sim + pipeline + app · **Origin:** original-ui plan reconciliation, 2026-07-12

The equipment component axis exists but the consumption behavior does not: the consume/drink drive
is unbuilt, the extractor does not populate `equip` on the real `ir.json`, and the potion/amulet
goods have no icons (their `landscapeType` has no `good piles all` record — the same gap leaves
`fruit` iconless).

**Source basis:** `CHANGE_ENERGY` (bucket 2) IS the food/hunger bar; only sleep writes the
tiredness bar (bucket 1) — so **mead restores hunger only** ("mead also restores sleep" is a
conflation with the internal ENERGY naming). Items have discrete uses shown as %;
weapons/armour/amulets don't wear. Effect magnitudes for heal/potion/amulet are NOT readable →
named calibration constants.

## Scope

- Pipeline: populate the `equip` lane from the readable data; bind icons for the iconless
  equippables (potions ×6, amulets ×6, fruit) — nearest-extractor mirror, not hand-built art.
- Sim: a consume/drink drive (drink when the matching need is low; decrement uses; typed empty
  case).
- App: an in-game equip/consume action on the unit panel; the Doświadczenie section stops reading
  empty once XP exists (already tracked via the barracks tickets).

## Verify

- `npm test`; pipeline run against the owned game copy (extraction changed).
- A scene where a hungry settler drinks mead and the hunger bar visibly refills — **user's eyes**.
