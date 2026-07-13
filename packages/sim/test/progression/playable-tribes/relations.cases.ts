import { IR_VERSION, parseContentSet } from '@vinland/data';
import { describe, expect, it } from 'vitest';
import { HUNTER_JOB, mayAttack, mayHunt } from '../../../src/systems/index.js';
import { tribeContent } from './support.js';

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
