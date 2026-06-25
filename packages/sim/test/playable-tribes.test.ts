import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { describe, expect, it } from 'vitest';
import {
  animalCannotBeAttacked,
  animalHitpoints,
  isAggressiveAnimal,
  isAnimalTribe,
  isPlayableTribe,
  mayAttack,
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
    ],
    // animaltypes records (keyed on tribeType): the bears (8) are aggressive with a HP pool; the
    // wolves (9) deliberately have NO record (a known animal tribe with no animaltypes behaviour). A
    // cannotBeAttacked entry for tribe 8 is NOT added so the bear stays attackable; a separate
    // exemption case is exercised in the mayAttack block with an inline content set.
    animals: [{ id: 'bear', tribeType: 8, aggressive: true, getAngry: true, hitpointsAdult: 15000 }],
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
