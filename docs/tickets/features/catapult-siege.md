# Implement catapult/siege combat (parked — data pinned, deliberately deferred)

**Area:** sim + render + app · **Origin:** combat plan reconciliation, 2026-07-12 · **Blocked by:**
[building-combat-damage](building-combat-damage.md), [tower-defence-mode](tower-defence-mode.md) · **Priority:** P3

Deliberately out of scope until field combat, building damage, and towers are complete. This
ticket parks the extracted data so it survives the retired combat plan (full research in git
history: `docs/plans/combat.md`, deleted 2026-07-12).

**Source basis (extracted, none of it in code yet):**

- weapons.ini: catapult range 8–24 (a close-in dead zone), `damagetype 2` + `hitself 1` +
  `createsmoke`; munition ROCK 2, projectile travel speed 3.
- logicdefines: `DAMAGE_TYPE_RADIAL 2` (splash), XP bucket `FIGHT_CATAPULT 76`, catapult
  `mainType 7`.
- atomicanimations: catapult attack length 48.
- Only a decorative `catapult` good (typeId 163) exists in code today.

## Scope

- Radial (splash) damage type, self-hit, smoke effect; the dead-zone minimum range; rock
  projectile; catapult unit/vehicle integration (crew model needs investigation — the original's
  crewing is unreadable, name the approximation).

## Verify

- `npm test`; a siege acceptance scene with catapults vs a walled/towered base — **user's eyes**.
