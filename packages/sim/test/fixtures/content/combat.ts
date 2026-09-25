export const combatContent = {
  // A weapon for the viking woodcutter (tribe 1, job 1) - the CombatSystem resolves an attacker's
  // weapon by (tribeType, jobType). maxRange 2 (the attacker can strike an enemy up to 2 cells away),
  // damage 50 vs an unarmored target (material "0"), 60 vs leather (material 1, before the armor's
  // blockingValue) and 50 vs an animal (material 2, the column every beast takes). Only a
  // Health-bearing settler ever fights, so this is inert in the golden slice.
  weapons: [
    // `hitSounds` mirrors the real `soundtype_Hit` shape: one impact group id per armor material.
    {
      typeId: 7,
      id: 'test_axe',
      tribeType: 1,
      jobType: 1,
      minRange: 1,
      maxRange: 2,
      damage: { '0': 50, '1': 60, '2': 50 },
      hitSounds: { '0': 82, '1': 83, '2': 82 },
    },
    // A weapon for the animal tribe (tribe 9, job 1) so an animal combatant CAN resolve a weapon -
    // this is what makes the combat-system test of the animal-exclusion meaningful: the animal is
    // skipped because it is an animal tribe, NOT merely because it is unarmed. damage 50 vs class 0.
    {
      typeId: 8,
      id: 'test_claw',
      tribeType: 9,
      jobType: 1,
      minRange: 1,
      maxRange: 2,
      damage: { '0': 50 },
    },
    // A weapon for the AGGRESSIVE animal tribe (bear, tribe 10, job 1) - so an aggressive animal can
    // resolve a weapon and actually swing at a nearby civilization (the civ-vs-animal aggression
    // drive). damage 40 vs an unarmored (class 0) target.
    {
      typeId: 9,
      id: 'test_bearfist',
      tribeType: 10,
      jobType: 1,
      minRange: 1,
      maxRange: 2,
      damage: { '0': 40 },
    },
    // A weapon for the PASSIVE-but-PROVOKABLE animal tribe (boar, tribe 12) - so once a boar is
    // PROVOKED (struck → `getAngry` → an `Anger` timer) it can actually fight back. Keyed by tribe
    // alone (a spawned animal carries no jobType), like test_bearfist. damage 30 vs an unarmored target.
    {
      typeId: 10,
      id: 'test_tusk',
      tribeType: 12,
      jobType: 1,
      minRange: 1,
      maxRange: 2,
      damage: { '0': 30 },
    },
    // The HUNTER's weapon (viking tribe 1, job 15 - `JOB_TYPE_HUMAN_HUNTER`) - so a hunter combatant
    // resolves a weapon and can strike `catchable` prey (the hunter-strike mechanic). damage 70 vs an
    // unarmored (class 0) target and an animal (class 2); the original binds `setatomic 15 81 "..._hunter_attack"` (atomic 81).
    // A RANGED weapon (a bow): `minRange 3, maxRange 17` mirrors the real `hunter_bow`
    // (`minimumrange 3`/`maximumrange 17` in `DataCnmd/types/weapons.ini`) - it CANNOT fire on a target
    // closer than 3 cells, the case the CombatSystem's minRange band enforces.
    // `missSounds` mirrors `soundtype_NoHit`: the thud per ground logic type (1 water, 2 land).
    {
      typeId: 11,
      id: 'test_spear',
      tribeType: 1,
      jobType: 15,
      minRange: 3,
      maxRange: 17,
      damage: { '0': 70, '2': 70 },
      hitSounds: { '0': 77, '2': 77 },
      missSounds: { '1': 78, '2': 79 },
    },
    // A weapon for the CATCHABLE-and-PROVOKABLE deer (tribe 14, keyed by tribe alone) - so once a
    // hunter's strike PROVOKES it (`getAngry` → an `Anger` timer) it can fight back. damage 20 vs an
    // unarmored target. `maxRange 3` so a deer provoked by a hunter firing from the bow's near reach
    // (minRange 3) can reach back at that distance without an advance-on-enemy drive (not yet modelled).
    {
      typeId: 12,
      id: 'test_antler',
      tribeType: 14,
      jobType: 1,
      minRange: 1,
      maxRange: 3,
      damage: { '0': 20 },
    },
  ],
  armor: [
    // Leather (class 1): a combatant stamped `Armor{armorClass:1}`, or wearing an `Equipment.armor`
    // slot holding `goodType` 1, resolves hits through this record's material column (test_axe
    // `damage["1"]` = 60), less its `blockingValue` on every blow that lands.
    { typeId: 1, id: 'leather', goodType: 1, blockingValue: 10 },
  ],
};
