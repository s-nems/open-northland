import { resolveSettlerBobId } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import { animalBinding } from '../src/content/animal-gfx/bindings.js';
import { animalExtraIdle, animalWalkVariants } from '../src/content/animal-gfx/extras.js';

const sequences = new Map([
  ['animal_deer_male_wait_1', { name: 'animal_deer_male_wait_1', start: 100, length: 36 }],
  ['animal_sheep_wait', { name: 'animal_sheep_wait', start: 200, length: 21 }],
  ['animal_wolf_wait_normal', { name: 'animal_wolf_wait_normal', start: 300, length: 12 }],
  ['animal_lion_male_walk_bak', { name: 'animal_lion_male_walk_bak', start: 400, length: 96 }],
  ['animal_duck_swim', { name: 'animal_duck_swim', start: 500, length: 72 }],
]);
const item = { kind: 'settler', ref: 0, x: 0, y: 0, depth: 0, facing: 0, state: 'idle' } as const;

describe('additional wildlife clips', () => {
  it.each([
    [11, 100, 12],
    [19, 200, 7],
    [20, 300, 4],
  ])('plays tribe %i gestures between waits, with three pose groups', (tribe, start, stride) => {
    const fidget = animalExtraIdle(tribe, sequences);
    expect(fidget).toBeDefined();
    if (fidget === undefined) return;
    const binding = {
      idle: 1,
      idleChoices: [{ start: 10, frameLists: [[0, 1]], loop: true }],
      idleFidgets: [fidget],
      moving: 2,
      byAtomic: { 81: 3 },
    };
    for (const [facing, group] of [
      [0, 0],
      [4, 1],
      [7, 2],
    ] as const) {
      const at = (elapsed: number) =>
        resolveSettlerBobId(binding, { ...item, facing }, elapsed, elapsed, elapsed);
      expect(at(179)).toBe(11);
      expect(at(180)).toBe(start + group * stride);
      expect(at(180 + stride * 3 - 1)).toBe(start + (group + 1) * stride - 1);
      expect(at(180 + stride * 3)).toBeLessThan(100);
      expect(resolveSettlerBobId(binding, { ...item, state: 'moving', facing }, 180)).toBe(2);
      expect(resolveSettlerBobId(binding, { ...item, state: 'acting', atomicId: 81, facing }, 180)).toBe(3);
    }
  });

  it('gives the second lion variant its alternate walk while retaining run, idle and attack', () => {
    const binding = { idle: 1, moving: 2, running: 3, byAtomic: { 81: 4 } };
    const variants = animalWalkVariants(25, binding, sequences);
    expect(variants).toHaveLength(2);
    const alternate = variants?.[1];
    if (alternate === undefined) throw new Error('missing alternate gait');
    expect(resolveSettlerBobId(alternate, { ...item, state: 'moving', facing: 4 }, 5)).toBe(453);
    expect(resolveSettlerBobId(alternate, { ...item, state: 'moving', running: true }, 5)).toBe(3);
    expect(resolveSettlerBobId(alternate, { ...item, state: 'acting', atomicId: 81 }, 5)).toBe(4);
    expect(animalWalkVariants(26, binding, sequences)).toBeUndefined();
    expect(animalWalkVariants(25, binding, new Map())).toBeUndefined();
  });

  it('replaces the erroneous duck bull program with a swim loop and held floating pose', () => {
    const binding = animalBinding(
      { gfxAtomics: [{ tribe: 31, job: 49, action: 5, bodySeq: 'animal_bull_wait', dirFrames: [[195]] }] },
      31,
      sequences,
    );
    if (binding === null) throw new Error('missing duck binding');
    for (let facing = 0; facing < 8; facing++) {
      expect(resolveSettlerBobId(binding, { ...item, facing }, 200)).toBe(500 + facing * 9);
      expect(resolveSettlerBobId(binding, { ...item, facing, state: 'moving' }, 8)).toBe(508 + facing * 9);
      expect(resolveSettlerBobId(binding, { ...item, facing, state: 'moving' }, 9)).toBe(500 + facing * 9);
    }
  });
});
