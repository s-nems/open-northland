import { IR_VERSION, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { isPlayableTribe, playableTribes } from '../../../src/systems/index.js';
import { tribeContent } from './support.js';

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
