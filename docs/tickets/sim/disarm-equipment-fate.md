# Return or drop a converted soldier's weapon and armor instead of vanishing them

**Area:** sim · **Origin:** review of fix/regression-fixes (gameplay lens), 2026-07-16 · **Priority:** P3

`reidleAsJob` (packages/sim/src/systems/orders/work.ts) disarms a fighter converted to a civilian
job so the skin follows the profession — but the equipped weapon/armor goods (crafted economy items,
e.g. sword good 44) are deleted from the world: not dropped as a GroundDrop, not returned to a
store. A player rotating soldiers through civilian work permanently destroys the armory. This is
inconsistent with the drop-on-interrupt rule the same function applies to a carried load (the plank
lands on the ground; the sword evaporates). The vanish is a named approximation in the code comment;
this ticket is the recovery.

Source basis to check first: observe what the original does with a converted soldier's kit (drop,
return to armory, or vanish). If the original vanishes it too, close this ticket by re-stating the
comment as observed behavior instead of an approximation.

## Scope

- Decide the fate per the original's observed behavior; failing an oracle, prefer dropping the
  equipment goods at the settler's feet (the interrupt rule's shape) via the existing drop path.
- Map `Equipment.weapon`/`Equipment.armor` (and the combat `Weapon`/`Armor` components) back to
  their good ids; the smithy recipes already bind good ↔ equipment.
- Test: convert an armed soldier; assert the weapon good reappears on the ground / in a store and
  total goods are conserved.

## Verify

`npm test` (goldens move only if the behavior change is intentional and named in the commit),
browser pass: convert an armed soldier and see the kit land.
