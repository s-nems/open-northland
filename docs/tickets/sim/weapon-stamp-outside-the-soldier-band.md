# Stamp the combat weapon for every wearer, not only the soldier band

**Area:** sim · **Priority:** P3

## Problem

`takeUpWeaponGood` (`systems/settlers/atomics/effects/goods/weapon-class.ts`) returns early unless
`isSoldierJob`, so a civilian, scout or hero that equips a weapon good never gets the `Weapon`
component. Two readers then disagree about what that settler holds:

- `attackerWeapon` (`systems/conflict/weapons.ts`) resolves by worn `Weapon` id, else by
  `(tribe, job)`, so the wearer fights unarmed.
- `walkStepModifiersOf` (`systems/movement/walk-cost.ts`) falls back to
  `weaponByTribeAndGoodType`, so the same wearer is encumbered by the weapon it cannot swing.

Owned `the original` `an original routine` (an original address) writes `this->WeaponType`
unconditionally and only *additionally* flips `JobType` when the human is inside the soldier bands
(`JobType - 31 < 11` or `JobType - 42 < 6`). `Equipment_GetWeaponType` (an original address) returns that one
field, which both `WalkSpeed_GetMoveSpeed` and the combat path read. So the engine has a single weapon
identity for every wearer, and the job flip is the soldier-only part.

## Scope

Split the two effects in `takeUpWeaponGood`: stamp/clear `Weapon` for any wearer whose good resolves to
a `[weapontype]` row of its tribe, and keep the `applyTradeChange` job flip and the assistant booking
inside the soldier band. Then let `equipmentWeight` read the stamped `Weapon` alone, dropping its
good-type fallback, so walk cost and combat read one resolution. Check the hero exemption, the
`layDownWeaponGood` path and a display-only weapon good with no class row.

## Verify

Unit cover: civilian/scout equip and unequip, a soldier class flip, a hero, and a display-only good.
Assert the same weapon row backs both `attackerWeapon` and `walkStepModifiersOf().equipmentWeight`.
Re-run the state-hash goldens; a changed golden names the behavior change in its commit.
