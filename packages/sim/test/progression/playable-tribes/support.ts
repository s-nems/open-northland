import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';

/**
 * The playable-tribes read view — `playableTribes`/`isPlayableTribe` distinguish the controllable
 * civilizations from the animal/monster tribes *by the data alone* (a non-empty `jobEnables` tech
 * graph), never by a hardcoded name or count. These tests pin that data-defined split: a civilization
 * (carries `jobEnables`) is playable, an animal (only atomic bindings) is not, the list is sorted by
 * `typeId` regardless of declaration order, and the membership predicate matches the list (incl. the
 * unknown-tribe boundary). A pure read over content — no world, no mechanic added.
 */

// Two civilizations and two animal tribes, deliberately declared OUT of typeId order so the sort is
// exercised. A civilization is signed by a `jobEnables` edge; an animal is pure atomic bindings.
export function tribeContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: 3, id: 'coin' }, // the good a frank's tech edge unlocks
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: 5, id: 'civilist' }, // the enabling job both tech edges hang off
    ],
    buildings: [
      { typeId: 1, id: 'headquarters', kind: 'headquarters' },
      { typeId: 4, id: 'home', kind: 'home' }, // the building a viking's tech edge unlocks
    ],
    tribes: [
      // frank (typeId 2) declared first — a civilization (has a tech-graph edge).
      { typeId: 2, id: 'frank', jobEnables: [{ jobType: 5, kind: 'good', targetId: 3 }] },
      // wolves (typeId 9) — an animal: atomic bindings only, no jobEnables.
      { typeId: 9, id: 'wolves', atomicBindings: [{ jobType: 0, atomicId: 1, animation: 'wolf_walk' }] },
      // viking (typeId 1) declared after frank — proves the sort, not declaration order.
      { typeId: 1, id: 'viking', jobEnables: [{ jobType: 5, kind: 'house', targetId: 4 }] },
      // bears (typeId 8) — another animal, even though it has many bindings it has no tech graph.
      { typeId: 8, id: 'bears', atomicBindings: [{ jobType: 0, atomicId: 1, animation: 'bear_walk' }] },
      // cows (typeId 10) — a CATCHABLE prey animal (the `mayHunt`/`isCatchableAnimal` fixture).
      { typeId: 10, id: 'cows', atomicBindings: [{ jobType: 0, atomicId: 1, animation: 'cow_walk' }] },
    ],
    // animaltypes records (keyed on tribeType): the bears (8) are aggressive with a HP pool; the
    // wolves (9) deliberately have NO record (a known animal tribe with no animaltypes behaviour). A
    // cannotBeAttacked entry for tribe 8 is NOT added so the bear stays attackable; a separate
    // exemption case is exercised in the mayAttack block with an inline content set.
    animals: [
      {
        id: 'bear',
        tribeType: 8,
        aggressive: true,
        getAngry: true,
        hitpointsAdult: 15000,
        // hitpoints_baby — the juvenile pool animalBabyHitpoints surfaces; deliberately < adult and
        // not derivable from it, proving it is a distinct extracted field, not adult-with-a-discount.
        hitpointsBaby: 8000,
        // herd/spawn params the herdParams read view surfaces
        maximumGroupSize: 4,
        searchForLeader: true,
        maximumLeaderDistance: 5,
        maximumDistanceToBirthPoint: 12,
        maximumDistanceToStayPoint: 7,
        // locomotion params the locomotionOf read view surfaces
        moveSpeed: 8,
        runSpeed: 5,
        // ignorehouses — a bear barges through buildings (ignoresHousesAnimal); NOT warrantable (wild).
        ignoreHouses: true,
      },
      // The cow (tribe 10) is CATCHABLE prey: passive (not aggressive/getAngry), tamable/huntable, and
      // WARRANTABLE (owned penned livestock — isWarrantableAnimal); it does NOT ignore houses (paths
      // around them like any settler).
      { id: 'cow', tribeType: 10, catchable: true, warrantable: true, hitpointsAdult: 1000 },
    ],
  });
}
