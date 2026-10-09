# Reserve Byzantine dragons for scenario player slots

**Area:** sim · **Priority:** P3

Original behavior: the Byzantine wooden-spear profession has 20000 hitpoints instead of 5000,
independent of its controller. The owned copy confirms this class-based exception; equipment
transitions have not been checked against the running original. CNMod's `weapons.ini` and
`atomicanimations.ini` give it range 3 and five strikes over 59 ticks (500 damage each against an unarmored target).

Authored balance: reserve that dragon for map-authored AI slots unavailable to humans. A claimable
slot uses a normal wooden spearman whether a human or replacement AI controls it. Both must coexist
on one map; controller changes never change the slot's classification.

## Scope

- Carry variants as validated tribe/job data selected by the owner's persistent scenario-slot role.
- Scenario variant: dragon graphics, 20000 HP, source combat timing, weapon and movement reduction.
- Playable variant: Byzantine iron-spearman graphics and animation timing, 5000 HP, ordinary wooden
  spear weapon values (the Viking source row) and no dragon movement reduction. Iron remains iron.
- Apply the same selection to initial placements, mission spawns, equipment/profession changes and
  mission ownership transfers. A changed health pool preserves the health fraction, rounded down
  with a minimum of one HP for a living unit.
- Persist slot roles through saves and use identical rules in local and network worlds.

## Verify

- One world containing a claimable human, replacement AI and scenario AI: distinct HP, range, damage,
  hit events, movement and graphics, including after equipment and ownership changes.
- Mission-created units, save/restore and controller changes retain the intended distinction.
- Real-content and browser checks show human spearmen and dragons together; changed state hashes
  reflect only these intentional rules and the persisted format change.
