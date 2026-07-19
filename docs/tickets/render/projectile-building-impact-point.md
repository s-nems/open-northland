# Land a besieging projectile on the near wall, not the building's anchor corner

**Area:** render (+ maybe sim projectile target) · **Origin:** attack-enemy-buildings review,
2026-07-19 · **Priority:** P3 (cosmetic)

An archer besieging a building stands at reach of its **nearest wall** (`combatTargetNode` /
`buildingBodyNodes`), but the projectile flies to and sparks at the target's `Position` — the
building's **anchor** node (`packages/sim/src/systems/conflict/projectile.ts` uses the target
entity's Position). On a wide building every arrow visibly overflies the near wall the archer aimed
past and detonates at one anchor corner, reading as if the archers are all shooting the same spot
behind the wall.

**Source basis:** the original's projectiles are munition types ARROW 1 / ROCK 2 with per-weapon
`munitiontype`+`speed` (weapons.ini); their exact impact point on a multi-cell building is not
decoded, so the fix is a faithfulness approximation (land on the struck face), named as such.

## Scope

Aim the projectile's impact at the wall cell the attacker actually engaged — the same
`combatTargetNode` the reach check used — instead of the anchor Position. If the projectile target
point lives in the sim (deterministic flight), thread the resolved wall node through; if the arc is
purely render-side, resolve the nearest wall in the projectile effect from the shooter's position.
Keep it deterministic (no per-frame RNG) so a `?shot` reproduces.

Small and self-contained; pairs with `projectile-sprite-hunt.md` (which replaces the placeholder
arrow bob) but is independent of it.

## Verify

`npm test`; `?scene=siege` with archers on a wide building (the HQ) — arrows land along the struck
face, not all at one corner (human eye).
