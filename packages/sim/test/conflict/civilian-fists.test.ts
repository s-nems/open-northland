import { parseContentSet } from '@open-northland/data';
import { expect, it } from 'vitest';
import { Simulation } from '../../src/index.js';
import { attackClipTiming, attackerWeapon } from '../../src/systems/conflict/weapons.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';

it('inherits tribe-local fists through civilian jobs while preserving explicit equipment and class weapons', () => {
  const content = parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [],
    buildings: [],
    jobs: [
      { typeId: 60, id: 'civilist' },
      { typeId: 31, id: 'soldier_unarmed', baseJob: 60 },
      { typeId: 38, id: 'soldier_axe', baseJob: 60 },
      { typeId: 42, id: 'hero_unarmed', baseJob: 60 },
      { typeId: 70, id: 'builder', baseJob: 60 },
      { typeId: 80, id: 'hunter', baseJob: 60 },
      { typeId: 4, id: 'child_male' },
    ],
    weapons: [
      { typeId: 1, id: 'fist', tribeType: 1, jobType: 31, minRange: 1, maxRange: 1, damage: { '0': 400 } },
      { typeId: 1, id: 'fist', tribeType: 2, jobType: 31, minRange: 1, maxRange: 1, damage: { '0': 500 } },
      { typeId: 8, id: 'hunter_bow', tribeType: 1, jobType: 80, minRange: 3, maxRange: 17 },
      { typeId: 9, id: 'house_bow', tribeType: 1, jobType: 60, minRange: 3, maxRange: 17 },
    ],
  });
  const ctx = ctxOf(new Simulation({ content, seed: 7 }));
  expect(attackerWeapon(ctx, 1, 60)?.weapon.damage['0']).toBe(400);
  expect(attackerWeapon(ctx, 2, 70)?.weapon.damage['0']).toBe(500);
  expect(attackerWeapon(ctx, 1, 80)?.weapon.id).toBe('hunter_bow');
  expect(attackerWeapon(ctx, 1, 60, 8)?.weapon.id).toBe('hunter_bow');
  expect(attackerWeapon(ctx, 1, 60, 999)).toBeNull();
  expect(attackerWeapon(ctx, 3, 60)).toBeNull();
  expect(attackerWeapon(ctx, 1, 4)).toBeNull();
  expect(attackerWeapon(ctx, 1, 38)).toBeNull();
  expect(attackerWeapon(ctx, 1, 42)).toBeNull();
  expect(attackerWeapon(ctx, 1, null)).toBeNull();
});

it('inherits civilian hit timing only for trades, with explicit job clips taking precedence', () => {
  const content = parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [],
    buildings: [],
    jobs: [
      { typeId: 60, id: 'civilist' },
      { typeId: 70, id: 'builder', baseJob: 60 },
      { typeId: 80, id: 'hunter', baseJob: 60 },
      { typeId: 31, id: 'soldier_unarmed', baseJob: 60 },
    ],
    tribes: [
      {
        typeId: 1,
        id: 'viking',
        atomicBindings: [
          { jobType: 60, atomicId: 81, animation: 'civilian_attack' },
          { jobType: 80, atomicId: 81, animation: 'hunter_attack' },
        ],
      },
    ],
    atomicAnimations: [
      { id: 'civilian_attack', name: 'civilian_attack', length: 16, events: [{ at: 6, type: 25 }] },
      { id: 'hunter_attack', name: 'hunter_attack', length: 25, events: [{ at: 11, type: 25 }] },
    ],
  });
  expect(attackClipTiming(content, { tribe: 1, jobType: 70 })).toEqual({ length: 16, shotAt: 6 });
  expect(attackClipTiming(content, { tribe: 1, jobType: 80 })).toEqual({ length: 25, shotAt: 11 });
  expect(attackClipTiming(content, { tribe: 1, jobType: 31 })).toEqual({ length: 4, shotAt: 4 });
  expect(attackClipTiming(content, { tribe: 2, jobType: 70 })).toEqual({ length: 4, shotAt: 4 });
});
