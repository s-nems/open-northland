# Implement defence mode and house-bow fire

**Area:** sim, app · **Priority:** P2

Tower garrisons now return fire: a bow soldier posted to a tower mans it, shoots from cover at his own
bow plus the tower's reach bonus, and is untargetable while he holds it (`systems/conflict/tower-post.ts`,
`settlers/drives/tower-post.ts`, `?scene=tower-garrison`). The other half of the extracted mode is still
missing - no `setDefenceMode` command exists, and no building fires the house bow.

**Source basis (extracted):** `logicCanEnableDefenceMode 1` sits on the headquarters (logictype 1),
barracks (39) and both towers (40/41); house bow = `weapons.ini` type 20, jobtype 6 (civilist!), range
0–29, dmg 375, arrow munition speed 7. What the mode DOES - who shelters, the fire cadence - is
unreadable → named approximations, log the choices.

## Scope

- A `setDefenceMode` command + a selected-building panel toggle, on every type the data marks.
- Civilians shelter inside an alarmed building and fire the house bow from it, reusing the garrison
  shelter machinery (`components/combat.ts` `Garrison`, `settlers/indoors.ts` `takePost`).
- A `?scene=defence-mode` acceptance scene.

## Verify

- `npm test` - existing goldens byte-identical.
- `?scene=defence-mode` - **user's eyes** (civilians running in, house-bow arrows from the walls).
