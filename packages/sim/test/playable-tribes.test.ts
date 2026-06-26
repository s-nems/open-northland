import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { describe, expect, it } from 'vitest';
import {
  HUNTER_JOB,
  animalBabyHitpoints,
  animalCannotBeAttacked,
  animalHitpoints,
  herdParams,
  isAggressiveAnimal,
  isAnimalTribe,
  isCatchableAnimal,
  isPlayableTribe,
  locomotionOf,
  mayAttack,
  mayHunt,
  playableTribes,
} from '../src/systems/index.js';

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
function tribeContent(): ContentSet {
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
      },
      // The cow (tribe 10) is CATCHABLE prey: passive (not aggressive/getAngry), tamable/huntable.
      { id: 'cow', tribeType: 10, catchable: true, hitpointsAdult: 1000 },
    ],
  });
}

describe('playableTribes', () => {
  it('returns only the tribes carrying a jobEnables tech graph (the civilizations)', () => {
    const ids = playableTribes(tribeContent()).map((t) => t.id);
    expect(ids).toEqual(['viking', 'frank']); // wolves/bears excluded — no jobEnables
  });

  it('sorts ascending by typeId regardless of declaration order', () => {
    // Declared frank(2) before viking(1); the view must still put viking first.
    const typeIds = playableTribes(tribeContent()).map((t) => t.typeId);
    expect(typeIds).toEqual([1, 2]);
  });

  it('is empty when no tribe carries a tech graph (e.g. an animals-only set)', () => {
    const content = parseContentSet({
      manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
      tribes: [{ typeId: 9, id: 'wolves', atomicBindings: [{ jobType: 0, atomicId: 1, animation: 'w' }] }],
    });
    expect(playableTribes(content)).toEqual([]);
  });

  it('is byte-stable call-to-call (a pure function of content)', () => {
    const content = tribeContent();
    expect(playableTribes(content)).toEqual(playableTribes(content));
  });
});

describe('isPlayableTribe', () => {
  it('is true for a civilization (has jobEnables) and false for an animal tribe', () => {
    const content = tribeContent();
    expect(isPlayableTribe(content, 1)).toBe(true); // viking
    expect(isPlayableTribe(content, 2)).toBe(true); // frank
    expect(isPlayableTribe(content, 9)).toBe(false); // wolves
    expect(isPlayableTribe(content, 8)).toBe(false); // bears
  });

  it('is false for an unknown tribe id (no matching record)', () => {
    expect(isPlayableTribe(tribeContent(), 99)).toBe(false);
  });

  it('agrees with playableTribes membership for every declared tribe', () => {
    const content = tribeContent();
    const playable = new Set(playableTribes(content).map((t) => t.typeId));
    for (const tribe of content.tribes) {
      expect(isPlayableTribe(content, tribe.typeId)).toBe(playable.has(tribe.typeId));
    }
  });
});

describe('isAnimalTribe', () => {
  it('is true for a recorded animal tribe (no tech graph) and false for a civilization', () => {
    const content = tribeContent();
    expect(isAnimalTribe(content, 9)).toBe(true); // wolves — recorded, no jobEnables
    expect(isAnimalTribe(content, 8)).toBe(true); // bears — recorded, no jobEnables
    expect(isAnimalTribe(content, 1)).toBe(false); // viking — a civilization
    expect(isAnimalTribe(content, 2)).toBe(false); // frank — a civilization
  });

  it('is false for an UNKNOWN tribe id — an absent record is not silently reclassified as an animal', () => {
    // The boundary `isAnimalTribe` exists to draw: `!isPlayableTribe(99)` is true, but tribe 99 is NOT
    // an animal (we have no record for it), so the combat drive must not treat it as wildlife.
    expect(isPlayableTribe(tribeContent(), 99)).toBe(false);
    expect(isAnimalTribe(tribeContent(), 99)).toBe(false);
  });

  it('partitions every RECORDED tribe with isPlayableTribe (exactly one of the two holds)', () => {
    const content = tribeContent();
    for (const tribe of content.tribes) {
      // For a recorded tribe, animal and playable are exact complements (XOR).
      expect(isAnimalTribe(content, tribe.typeId)).toBe(!isPlayableTribe(content, tribe.typeId));
    }
  });
});

describe('isAggressiveAnimal / animalCannotBeAttacked / animalHitpoints (animaltypes read views)', () => {
  it('isAggressiveAnimal reads the `aggressive` flag off the animaltypes record', () => {
    const content = tribeContent();
    expect(isAggressiveAnimal(content, 8)).toBe(true); // bears — aggressive record
    expect(isAggressiveAnimal(content, 9)).toBe(false); // wolves — animal tribe but NO animaltypes record
    expect(isAggressiveAnimal(content, 1)).toBe(false); // viking — a civilization, not an animal
    expect(isAggressiveAnimal(content, 99)).toBe(false); // unknown tribe — no record
  });

  it('animalHitpoints returns the adult HP pool, or null for a tribe with no animal record', () => {
    const content = tribeContent();
    expect(animalHitpoints(content, 8)).toBe(15000); // bears — hitpointsAdult
    expect(animalHitpoints(content, 9)).toBeNull(); // wolves — no animaltypes record
    expect(animalHitpoints(content, 1)).toBeNull(); // viking — a civilization
  });

  it('animalBabyHitpoints returns the juvenile HP pool, distinct from the adult, or null with no record', () => {
    const content = tribeContent();
    expect(animalBabyHitpoints(content, 8)).toBe(8000); // bears — hitpointsBaby, NOT the 15000 adult pool
    expect(animalBabyHitpoints(content, 10)).toBe(0); // cows — record with no hitpointsBaby → extractor default 0
    expect(animalBabyHitpoints(content, 9)).toBeNull(); // wolves — no animaltypes record
    expect(animalBabyHitpoints(content, 1)).toBeNull(); // viking — a civilization
  });

  it('animalCannotBeAttacked exempts a decorative-fauna animal (cannotbeattacked)', () => {
    const content = parseContentSet({
      manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
      tribes: [
        { typeId: 5, id: 'bees', atomicBindings: [{ jobType: 0, atomicId: 1, animation: 'b' }] },
        { typeId: 6, id: 'wasps', atomicBindings: [{ jobType: 0, atomicId: 1, animation: 'w' }] },
      ],
      animals: [
        { id: 'bee', tribeType: 5, aggressive: true, cannotBeAttacked: true, hitpointsAdult: 200 },
        { id: 'wasp', tribeType: 6, aggressive: true, hitpointsAdult: 200 },
      ],
    });
    expect(animalCannotBeAttacked(content, 5)).toBe(true); // bee — decorative, exempt
    expect(animalCannotBeAttacked(content, 6)).toBe(false); // wasp — attackable
    expect(animalCannotBeAttacked(content, 1)).toBe(false); // unknown — not exempt
  });
});

describe('herdParams (the animal herd/spawn read view)', () => {
  it('surfaces the herd/spawn params off the animaltypes record as one struct', () => {
    const params = herdParams(tribeContent(), 8); // bears
    expect(params).toEqual({
      maxGroupSize: 4, // maximumGroupSize
      searchForLeader: true, // searchForLeader
      leaderDistance: 5, // maximumLeaderDistance
      birthPointRange: 12, // maximumDistanceToBirthPoint
      stayPointRange: 7, // maximumDistanceToStayPoint
    });
  });

  it('returns null for a tribe with no animal record (an animal tribe lacking the record, or a civ)', () => {
    const content = tribeContent();
    expect(herdParams(content, 9)).toBeNull(); // wolves — animal tribe but NO animaltypes record
    expect(herdParams(content, 1)).toBeNull(); // viking — a civilization
    expect(herdParams(content, 99)).toBeNull(); // unknown tribe — no record
  });

  it('defaults a source-omitted herd field to 0/false rather than guessing (a solitary animal)', () => {
    // A minimal animal record (only the required id+tribeType): the schema fills the herd params with
    // their source-omitted defaults, and the read view passes them through verbatim — no inference.
    const content = parseContentSet({
      manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
      tribes: [{ typeId: 7, id: 'eagle', atomicBindings: [{ jobType: 0, atomicId: 1, animation: 'e' }] }],
      animals: [{ id: 'eagle', tribeType: 7 }],
    });
    expect(herdParams(content, 7)).toEqual({
      maxGroupSize: 0,
      searchForLeader: false,
      leaderDistance: 0,
      birthPointRange: 0,
      stayPointRange: 0,
    });
  });
});

describe('locomotionOf (the animal walk/run-speed read view)', () => {
  it('surfaces the movespeed/runspeed off the animaltypes record as one struct', () => {
    const params = locomotionOf(tribeContent(), 8); // bears: movespeed 8, runspeed 5
    expect(params).toEqual({
      walkSpeed: 8, // moveSpeed
      runSpeed: 5, // runSpeed
    });
  });

  it('returns null for a tribe with no animal record (an animal tribe lacking the record, or a civ)', () => {
    const content = tribeContent();
    expect(locomotionOf(content, 9)).toBeNull(); // wolves — animal tribe but NO animaltypes record
    expect(locomotionOf(content, 1)).toBeNull(); // viking — a civilization
    expect(locomotionOf(content, 99)).toBeNull(); // unknown tribe — no record
  });

  it('defaults a source-omitted speed to 0 rather than guessing (the engine default applies)', () => {
    // The cow record (tribe 10) sets neither movespeed nor runspeed; the read view passes the
    // schema's source-omitted 0 through verbatim — no inference of a default pace.
    expect(locomotionOf(tribeContent(), 10)).toEqual({
      walkSpeed: 0,
      runSpeed: 0,
    });
  });
});

describe('mayAttack (the combat hostility relation)', () => {
  it('is false within a tribe (friendly fire is off)', () => {
    const content = tribeContent();
    expect(mayAttack(content, 1, 1)).toBe(false); // viking vs viking
    expect(mayAttack(content, 8, 8)).toBe(false); // bear vs bear (same tribe)
  });

  it('is true between two different civilizations (player-vs-player)', () => {
    const content = tribeContent();
    expect(mayAttack(content, 1, 2)).toBe(true); // viking -> frank
    expect(mayAttack(content, 2, 1)).toBe(true); // frank -> viking
  });

  it('treats an UNKNOWN target tribe (no record) as a civilization, a valid enemy', () => {
    // The three-truth-states rule: a no-record different tribe is not an animal, so it stays a PvP enemy.
    expect(mayAttack(tribeContent(), 1, 99)).toBe(true);
  });

  it('lets a civilization engage an AGGRESSIVE animal but leaves a PASSIVE animal alone', () => {
    const content = tribeContent();
    expect(mayAttack(content, 1, 8)).toBe(true); // viking -> aggressive bear
    expect(mayAttack(content, 1, 9)).toBe(false); // viking -> passive wolves (no record) — hunting is separate
  });

  it('lets an aggressive animal attack a civilization (the unprovoked drive)', () => {
    expect(mayAttack(tribeContent(), 8, 1)).toBe(true); // bear -> viking
  });

  it('is false between two animals (no inter-species wildlife aggression)', () => {
    expect(mayAttack(tribeContent(), 8, 9)).toBe(false); // bear -> wolves
  });

  it('a PASSIVE animal (no record / not aggressive) attacks NOTHING (the gate is self-contained)', () => {
    const content = tribeContent();
    // wolves (tribe 9) are a known animal tribe with no animaltypes record -> not aggressive.
    expect(mayAttack(content, 9, 1)).toBe(false); // passive wolf -> viking: no fight
    expect(mayAttack(content, 9, 2)).toBe(false); // passive wolf -> frank: no fight
    expect(mayAttack(content, 9, 8)).toBe(false); // passive wolf -> bear: animals don't fight anyway
  });

  it('exempts a cannotBeAttacked animal from a civilization, while it can still attack', () => {
    const content = parseContentSet({
      manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
      tribes: [
        { typeId: 1, id: 'viking', jobEnables: [{ jobType: 0, kind: 'good', targetId: 0 }] },
        { typeId: 5, id: 'bees', atomicBindings: [{ jobType: 0, atomicId: 1, animation: 'b' }] },
      ],
      animals: [{ id: 'bee', tribeType: 5, aggressive: true, cannotBeAttacked: true, hitpointsAdult: 200 }],
    });
    expect(mayAttack(content, 1, 5)).toBe(false); // viking cannot attack the bee (decorative-fauna exempt)
    expect(mayAttack(content, 5, 1)).toBe(true); // but the aggressive bee can attack the viking
  });
});

describe('isCatchableAnimal (the catchable prey read view)', () => {
  it('is true for a catchable animal, false for non-catchable / civ / unknown', () => {
    const content = tribeContent();
    expect(isCatchableAnimal(content, 10)).toBe(true); // cow — catchable
    expect(isCatchableAnimal(content, 8)).toBe(false); // bear — aggressive, not catchable
    expect(isCatchableAnimal(content, 9)).toBe(false); // wolves — no animaltypes record
    expect(isCatchableAnimal(content, 1)).toBe(false); // viking — a civilization
    expect(isCatchableAnimal(content, 99)).toBe(false); // unknown tribe
  });
});

describe('mayHunt (the hunter predation relation)', () => {
  it('lets a HUNTER strike catchable prey, but a non-hunter / non-catchable target does not', () => {
    const content = tribeContent();
    expect(mayHunt(content, HUNTER_JOB, 10)).toBe(true); // hunter -> catchable cow
    expect(mayHunt(content, 1, 10)).toBe(false); // a non-hunter trade does not hunt
    expect(mayHunt(content, null, 10)).toBe(false); // a jobless settler does not hunt
    expect(mayHunt(content, HUNTER_JOB, 8)).toBe(false); // hunter -> aggressive bear (not catchable)
    expect(mayHunt(content, HUNTER_JOB, 9)).toBe(false); // hunter -> wild wolf (no catchable flag)
    expect(mayHunt(content, HUNTER_JOB, 1)).toBe(false); // a civilization is not huntable prey
  });

  it('still exempts a cannotBeAttacked animal even if (somehow) catchable', () => {
    const content = parseContentSet({
      manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
      tribes: [
        { typeId: 1, id: 'viking', jobEnables: [{ jobType: 0, kind: 'good', targetId: 0 }] },
        { typeId: 5, id: 'tame_bees', atomicBindings: [{ jobType: 0, atomicId: 1, animation: 'b' }] },
      ],
      animals: [
        { id: 'tame_bee', tribeType: 5, catchable: true, cannotBeAttacked: true, hitpointsAdult: 200 },
      ],
    });
    // The cannotBeAttacked exemption holds for hunting too — a hunter can no more strike it than a soldier.
    expect(mayHunt(content, HUNTER_JOB, 5)).toBe(false);
  });
});
