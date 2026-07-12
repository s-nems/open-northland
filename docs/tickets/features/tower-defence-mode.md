# Implement tower garrisons and defence mode

**Area:** sim + app · **Origin:** combat plan reconciliation, 2026-07-12 · **Blocked by:**
[building-combat-damage](building-combat-damage.md)

No garrison fire, no defence-mode command exists (`core/commands.ts` has neither).

**Source basis (extracted):** towers logictype 40/41, maintype 5 FIGHT, garrison `logicworker`
3–4× short-bow job 40 + long-bow job 41 + carriers; `logicCanEnableDefenceMode 1` also on HQ
(logictype 1) and barracks (39); house bow = weapons.ini type 20, jobtype 6 (civilist!), range
0–29, dmg 375, arrow munition speed 7. Garrison shelter semantics and defence-mode fire cadence
are unreadable → named approximations, log the choices.

## Scope

- Tower garrison fire using the existing worker-slot machinery; garrisoned units hidden and
  untargetable.
- Defence-mode command + selected-building panel toggle + house-bow fire from enabled buildings.
- A `?scene=tower-defence` acceptance scene.

## Verify

- `npm test` — existing goldens byte-identical.
- `?scene=tower-defence` — **user's eyes** (arrows from the tower, attackers fall, tower falls).
