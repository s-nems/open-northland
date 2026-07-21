# Implement the consume/drink drive for potions and mead

**Area:** sim + app · **Priority:** P2
**Blocked by:** [equipment extraction](../pipeline/equipment-consumables-extraction.md)

The equipment component axis exists but the consumption behavior does not: the consume/drink drive
is unbuilt. (The extraction half — populating `equip` in `ir.json` + icons for the iconless
equippables — is the blocking pipeline ticket above.)

**Source basis:** `CHANGE_ENERGY` (bucket 2) IS the food/hunger bar; only sleep writes the
tiredness bar (bucket 1) — so **mead restores hunger only** ("mead also restores sleep" is a
conflation with the internal ENERGY naming). Items have discrete uses shown as %. Effect
magnitudes for heal/potion/amulet are NOT readable → named calibration constants.

## Scope

- Sim: a consume/drink drive (drink when the matching need is low; decrement uses; typed empty
  case).
- App: an in-game equip/consume action on the unit panel; the Doświadczenie section stops reading
  empty once XP exists (already tracked via the barracks tickets).

## Verify

- `npm test`.
- A scene where a hungry settler drinks mead and the hunger bar visibly refills — **user's eyes**.
