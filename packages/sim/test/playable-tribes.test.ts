import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { describe, expect, it } from 'vitest';
import { isAnimalTribe, isPlayableTribe, playableTribes } from '../src/systems/index.js';

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
