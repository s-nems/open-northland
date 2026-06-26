import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';

/**
 * A tiny, HAND-AUTHORED synthetic content set for tests. It contains NO copyrighted game data —
 * just enough goods/jobs/buildings to exercise the sim deterministically. Real content is
 * generated from an owned game copy into content/ (gitignored), so it can't be a committed test
 * fixture; this synthetic set is what keeps golden/scenario tests reproducible across machines.
 *
 * Keep it small and stable. When the schema grows, update here in lockstep.
 */
export function testContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      // Wood is harvested with atomic 24 (atomicForHarvesting), the join key the planner reads.
      { typeId: 1, id: 'wood', weight: 1, atomics: { harvest: 24 } },
      { typeId: 2, id: 'plank', weight: 1 },
      // An edible good — the eat-drive recognises it by the `food` id prefix (isFood), like the
      // original's food_simple/food_extra; a hungry settler eats it from its carry or a store.
      { typeId: 3, id: 'food_simple', weight: 1 },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      // The woodcutter is permitted the wood harvest atomic (24) — the planner's data-driven gate.
      { typeId: 1, id: 'woodcutter', allowedAtomics: [24] },
      { typeId: 2, id: 'carpenter' },
      // The hunter (job 15 — `JOB_TYPE_HUMAN_HUNTER`) — the trade that strikes `catchable` prey.
      { typeId: 15, id: 'hunter' },
      { typeId: 36, id: 'carrier' },
    ],
    buildings: [
      {
        typeId: 1,
        id: 'headquarters',
        kind: 'headquarters',
        workers: [{ jobType: 1, count: 3 }],
        stock: [
          { goodType: 1, capacity: 150, initial: 10 },
          { goodType: 2, capacity: 150, initial: 0 },
          // A food slot so the HQ can act as the settlement larder a hungry settler eats from.
          { goodType: 3, capacity: 150, initial: 0 },
        ],
      },
      {
        typeId: 2,
        id: 'sawmill',
        kind: 'workplace',
        workers: [{ jobType: 2, count: 1 }],
        stock: [
          { goodType: 1, capacity: 20, initial: 0 },
          { goodType: 2, capacity: 20, initial: 0 },
        ],
        recipe: { inputs: [{ goodType: 1, amount: 1 }], outputs: [{ goodType: 2, amount: 1 }], ticks: 20 },
      },
      {
        // The "work temple" (original logictype 37, logicmaintype 3): a `workplace` kind with NO
        // workers, NO stock, NO recipe — the structural signature isTemple() recognises as the pray
        // satisfier site. A devout settler walks here and runs the pray atomic to reset its piety.
        typeId: 3,
        id: 'temple',
        kind: 'workplace',
      },
      {
        // A tech-gated workplace: the viking tribe's `jobEnablesHouse` edge below locks it behind the
        // carpenter job (2), so it can only be placed once a carpenter settler exists in the tribe.
        // Nothing in the vertical slice / golden places this, so the placement gate leaves them alone.
        typeId: 4,
        id: 'smithy',
        kind: 'workplace',
      },
    ],
    landscape: [
      { typeId: 0, id: 'grass', walkable: true, buildable: true },
      { typeId: 1, id: 'water', walkable: false, buildable: false },
    ],
    // A weapon for the viking woodcutter (tribe 1, job 1) — the CombatSystem resolves an attacker's
    // weapon by (tribeType, jobType). maxRange 2 (the attacker can strike an enemy up to 2 cells away),
    // damage 50 vs an unarmored target (class "0") and 60 vs leather (class 1, mitigated by its
    // blockingValue). Only a Health-bearing settler ever fights, so this is inert in the golden slice.
    weapons: [
      {
        typeId: 7,
        id: 'test_axe',
        tribeType: 1,
        jobType: 1,
        minRange: 1,
        maxRange: 2,
        damage: { '0': 50, '1': 60 },
      },
      // A weapon for the animal tribe (tribe 9, job 1) so an animal combatant CAN resolve a weapon —
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
      // A weapon for the AGGRESSIVE animal tribe (bear, tribe 10, job 1) — so an aggressive animal can
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
      // A weapon for the PASSIVE-but-PROVOKABLE animal tribe (boar, tribe 12) — so once a boar is
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
      // The HUNTER's weapon (viking tribe 1, job 15 — `JOB_TYPE_HUMAN_HUNTER`) — so a hunter combatant
      // resolves a weapon and can strike `catchable` prey (the hunter-strike mechanic). damage 70 vs an
      // unarmored (class 0) target; the original binds `setatomic 15 81 "..._hunter_attack"` (atomic 81).
      // A RANGED weapon (a bow): `minRange 3, maxRange 17` mirrors the real `hunter_bow`
      // (`minimumrange 3`/`maximumrange 17` in `DataCnmd/types/weapons.ini`) — it CANNOT fire on a target
      // closer than 3 cells, the case the CombatSystem's minRange band enforces.
      {
        typeId: 11,
        id: 'test_spear',
        tribeType: 1,
        jobType: 15,
        minRange: 3,
        maxRange: 17,
        damage: { '0': 70 },
      },
      // A weapon for the CATCHABLE-and-PROVOKABLE deer (tribe 14, keyed by tribe alone) — so once a
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
      // Leather (class 1) mitigates 10 — so a 60-raw hit (test_axe `damage["1"]`) lands 50 net on a
      // leather-clad target. Now consumed by the combat drive: a combatant stamped `Armor{armorClass:1}`
      // resolves a hit through this record (the `damage[class] - blockingValue` join), and it makes the
      // `combatDamage` read view exercise a real armor record alongside the unarmored class.
      { typeId: 1, id: 'leather', goodType: 1, blockingValue: 10 },
    ],
    tribes: [
      {
        typeId: 1,
        id: 'viking',
        // The woodcutter (job 1) plays "viking_chop" for the harvest atomic (24); the planner
        // resolves its duration through this binding -> atomicAnimations length below. The eat atomic
        // (10, the original's eat-slot id) binds to "viking_eat" for every job (the woodcutter's row
        // is enough for the slice — a settler eats with the eat atomic regardless of trade). The
        // sleep atomic (8, the original's sleep-slot id) binds to "viking_sleep" the same way.
        atomicBindings: [
          { jobType: 1, atomicId: 24, animation: 'viking_chop' },
          { jobType: 1, atomicId: 10, animation: 'viking_eat' },
          { jobType: 1, atomicId: 8, animation: 'viking_sleep' },
          // The pray atomic (12, the original's pray-slot id) binds to "viking_pray" — the planner
          // resolves its duration through this binding -> atomicAnimations length below.
          { jobType: 1, atomicId: 12, animation: 'viking_pray' },
          // The attack atomic (81, the original's `setatomic <job> 81 "..._attack"` slot) binds to
          // "viking_attack" — the CombatSystem resolves the swing's duration through this binding.
          { jobType: 1, atomicId: 81, animation: 'viking_attack' },
          // The HUNTER (job 15) binds the SAME attack atomic (81) to "viking_hunter_attack" — the
          // original's `setatomic 15 81 "viking_hunter_attack"`. A hunter's strike on prey reuses the
          // combat attack path; the CombatSystem resolves its swing duration through this binding.
          { jobType: 15, atomicId: 81, animation: 'viking_hunter_attack' },
        ],
        // Tech-graph edges. (1) the carpenter (job 2) unlocks the smithy (house 4): the placement gate
        // (buildingEnabled) reads this — the smithy can only be placed once a carpenter settler exists.
        // (2) the WOODCUTTER (job 1) unlocks producing PLANK (good 2): the production gate (goodEnabled)
        // reads this — a sawmill can't make planks until a woodcutter is alive in the tribe, even when
        // its own carpenter operator is present. The HQ/sawmill (houses 1/2) carry no house edge so
        // they stay ungated for placement; the slice always has a woodcutter so the golden is unaffected.
        jobEnables: [
          { jobType: 2, kind: 'house', targetId: 4 },
          { jobType: 1, kind: 'good', targetId: 2 },
        ],
        // The XP threshold (the `needfor*` half): a `needforgood` on PLANK (good 2, 30 XP in the
        // woodcutter-wood track typeId 1) — the accrued-XP gate on top of the `jobEnables` who-unlocks-it
        // gate, exercised by `settlerMeetsNeed`/`experienceRequirementMet` (progression-system.test.ts).
        // PLANK is never *harvested* (only produced at the sawmill), so the AI harvest-side `needforgood`
        // gate (nearestHarvestableFor) is inert here — the golden slice is untouched; harvest-need-gate.test.ts
        // injects a thresholded HARVESTABLE good to exercise that gate. A `train` requirement (a schooling
        // cost, not an accrued-XP threshold) is included to confirm the reader skips it.
        jobRequirements: [
          { requirement: 'need', target: 'good', targetId: 2, amount: 30, experienceTypes: [1] },
          { requirement: 'train', target: 'good', targetId: 2, amount: 999, experienceTypes: [77] },
        ],
      },
      {
        // An ANIMAL tribe (typeId 9): a recorded `[tribetype]` with **no** `jobEnables` tech graph —
        // the data signature `isAnimalTribe` recognises (only a civilization carries `jobEnables`). It
        // binds the attack atomic (81) so an animal *could* swing, which lets the combat test prove the
        // animal is left out of the **player-vs-player** drive by its tribe class, not by being unarmed.
        // Declared AFTER the viking so `tribes[0]` stays the viking (other fixtures index `tribes[0]`).
        typeId: 9,
        id: 'test_wolves',
        atomicBindings: [{ jobType: 1, atomicId: 81, animation: 'wolf_attack' }],
      },
      {
        // An AGGRESSIVE animal tribe (bear, typeId 10): like the wolves it carries no `jobEnables` tech
        // graph (so `isAnimalTribe` is true), but its `animaltypes` record below sets `aggressive`, so it
        // DOES run the civ-vs-animal attack drive — a bear charges a nearby settler, and the settler
        // fights back (the mutual `mayAttack` relation). Binds the attack atomic (81) so it can swing.
        typeId: 10,
        id: 'test_bear',
        atomicBindings: [{ jobType: 1, atomicId: 81, animation: 'bear_attack' }],
      },
      {
        // A decorative-fauna animal tribe (bee, typeId 11): a known animal tribe (no `jobEnables`) whose
        // `animaltypes` record sets `cannotBeAttacked`, so a civilization is EXEMPT from attacking it
        // (the bee is never a valid target) — even though the record also flags it aggressive.
        typeId: 11,
        id: 'test_bees',
      },
      {
        // A PASSIVE-but-PROVOKABLE animal tribe (boar, typeId 12): a known animal tribe (no `jobEnables`)
        // whose `animaltypes` record sets `getAngry` (and NOT `aggressive`) — it picks no fight on its
        // own, but if STRUCK it turns hostile for `angryGameTime` ticks (the provoked-anger half). Binds
        // the attack atomic (81) so a provoked boar can swing back.
        typeId: 12,
        id: 'test_boar',
        atomicBindings: [{ jobType: 1, atomicId: 81, animation: 'boar_attack' }],
      },
      {
        // A CATCHABLE prey animal tribe (cow, typeId 13): a known animal tribe (no `jobEnables`) whose
        // `animaltypes` record sets `catchable` (and is passive — not aggressive, not getAngry). An
        // ordinary civilization leaves it alone, but a HUNTER (job 15) may strike it (the hunter-strike
        // mechanic). It binds no attack atomic — prey doesn't fight back unless provoked, and a plain cow
        // isn't even `getAngry`.
        typeId: 13,
        id: 'test_cow',
      },
      {
        // A CATCHABLE-and-PROVOKABLE prey animal tribe (deer, typeId 14): `catchable` AND `getAngry` (NOT
        // aggressive). A hunter's strike on it is the PROVOCATION SOURCE — the hit stamps an `Anger` timer
        // so the deer fights back, exactly the source the anger timer waits on. Binds the attack atomic so
        // a provoked deer can swing back.
        typeId: 14,
        id: 'test_deer',
        atomicBindings: [{ jobType: 1, atomicId: 81, animation: 'deer_attack' }],
      },
    ],
    // animaltypes.ini records, keyed on `tribeType` (an animal's identity IS its tribe). The bear
    // (tribe 10) is `aggressive` (attacks civilizations unprovoked) with an adult HP pool the
    // `Health`-stamp reads; the wolves (tribe 9) deliberately have NO record (the "known animal tribe
    // with no animaltypes record" path — not aggressive, never targeted). A `cannotBeAttacked` bee
    // (tribe 11) is recorded to exercise the decorative-fauna target exemption.
    animals: [
      // The bear also carries herd params so the spawnAnimalHerd command has a real group to place: a
      // pack of 3 that follows a leader (searchForLeader), ranging up to 2 tiles from its birth point,
      // and roaming up to 3 tiles from its leader (maximumLeaderDistance — the herdingSystem cohesion radius).
      // `moveSpeed 8` (the real cow/boar value) gives it a data-pinned walking pace: it walks ONE/8
      // tile/tick (the MoveSpeed stamp), exercising the per-entity movement pace. `runSpeed 4` is its
      // (faster) run gait — a smaller number than its `moveSpeed`, matching the real data where every
      // animal that sets both has `runspeed < movespeed` — stamped as the MoveSpeed's `runPerTick` (the
      // deferred flee/charge drive's pace; recorded but not yet consumed).
      {
        id: 'bear',
        tribeType: 10,
        aggressive: true,
        getAngry: true,
        hitpointsAdult: 15000,
        maximumGroupSize: 3,
        searchForLeader: true,
        maximumLeaderDistance: 3,
        maximumDistanceToBirthPoint: 2,
        moveSpeed: 8,
        runSpeed: 4,
      },
      // The bee is a SOLITARY animal (no maximumGroupSize, searchForLeader false) — the spawn places
      // exactly one and adds no HerdMember.
      { id: 'bee', tribeType: 11, aggressive: true, cannotBeAttacked: true, hitpointsAdult: 200 },
      // The boar is PASSIVE but PROVOKABLE: `getAngry` (NOT `aggressive`) with an `angryGameTime` of 10
      // — struck once, it stays hostile for 10 ticks then reverts. The provoked-anger fixture. It sets a
      // `moveSpeed` but NO `runSpeed` — the "walk pace known, run gait omitted" case, so its MoveSpeed
      // carries `runPerTick: null`.
      {
        id: 'boar',
        tribeType: 12,
        getAngry: true,
        angryGameTime: 10,
        hitpointsAdult: 1000,
        moveSpeed: 8,
      },
      // The cow is CATCHABLE prey: `catchable` and fully passive (NOT aggressive, NOT getAngry). A hunter
      // (job 15) may strike it; an ordinary civilization leaves it alone, and it never fights back. Its
      // `maximumCadaverSize` (4, the real catchable-animal value) is the meat yield a hunter's killing
      // blow harvests off the carcass (the `harvest_cadaver` follow-up).
      { id: 'cow', tribeType: 13, catchable: true, hitpointsAdult: 1000, maximumCadaverSize: 4 },
      // The deer is CATCHABLE AND PROVOKABLE: `catchable` + `getAngry` (NOT aggressive), `angryGameTime`
      // 10 — a hunter's strike provokes it (the provocation SOURCE), then it fights back for 10 ticks.
      {
        id: 'deer',
        tribeType: 14,
        catchable: true,
        getAngry: true,
        angryGameTime: 10,
        hitpointsAdult: 1000,
      },
    ],
    atomicAnimations: [
      { id: 'viking_chop', name: 'viking_chop', length: 3 },
      { id: 'viking_eat', name: 'viking_eat', length: 5 },
      { id: 'viking_sleep', name: 'viking_sleep', length: 6 },
      { id: 'viking_pray', name: 'viking_pray', length: 7 },
      { id: 'viking_attack', name: 'viking_attack', length: 4 },
      { id: 'viking_hunter_attack', name: 'viking_hunter_attack', length: 4 },
      { id: 'wolf_attack', name: 'wolf_attack', length: 4 },
      { id: 'bear_attack', name: 'bear_attack', length: 4 },
      { id: 'boar_attack', name: 'boar_attack', length: 4 },
      { id: 'deer_attack', name: 'deer_attack', length: 4 },
    ],
    // Experience tracks (humanjobexperiencetypes): the woodcutter (job 1) has a wood-specific track
    // (good 1, the narrow `(job, good)` specialization) and a general track (no good) — so the
    // ProgressionSystem prefers the wood track when chopping wood and the general one otherwise.
    jobExperience: [
      {
        typeId: 1,
        id: 'woodcutter_wood',
        name: 'woodcutter wood',
        jobType: 1,
        goodType: 1,
        experienceFactor: 10,
      },
      { typeId: 2, id: 'woodcutter_general', name: 'woodcutter general', jobType: 1, experienceFactor: 1 },
    ],
  });
}
