import { describe, expect, it } from 'vitest';
import { sandboxContent } from '../src/game/sandbox/content/index.js';

describe('sandbox creature data', () => {
  const content = sandboxContent();

  it('keeps the monster initial natural weapon on its tribe record', () => {
    for (const typeId of [5, 6]) {
      expect(content.tribes.find((tribe) => tribe.typeId === typeId)?.naturalWeaponType).toBe(1);
    }
    expect(content.tribes.find((tribe) => tribe.typeId === 8)?.naturalWeaponType).toBeUndefined();
  });

  it('uses the source default walking step period for bears with no movespeed key', () => {
    for (const tribeType of [8, 18]) {
      expect(content.animals.find((row) => row.tribeType === tribeType)?.moveSpeed).toBe(8);
    }
  });

  it('binds every supported threat to a scoped natural weapon with all armor columns', () => {
    const expectedWeapons = [
      { tribeType: 5, id: 'claw', jobType: 31, damage: [1600, 800, 1200, 400, 400, 40, 150] },
      { tribeType: 6, id: 'claw', jobType: 31, damage: [1600, 800, 1200, 400, 400, 40, 150] },
      { tribeType: 8, id: 'bearfist', damage: [800, 400, 600, 200, 200, 50, 50] },
      { tribeType: 18, id: 'evilrabbitbit', damage: [1300, 650, 975, 325, 325, 50, 50] },
      { tribeType: 20, id: 'wolvefist', damage: [350, 175, 260, 85, 85, 50, 50] },
      { tribeType: 25, id: 'lionmalefist', damage: [800, 400, 600, 200, 200, 50, 50] },
      { tribeType: 26, id: 'lionfemalefist', damage: [800, 400, 600, 200, 200, 50, 50] },
    ] as const;
    for (const expected of expectedWeapons) {
      const weapon = content.weapons.find(
        (row) => row.tribeType === expected.tribeType && row.id === expected.id,
      );
      expect(weapon?.typeId).toBe(1);
      expect(weapon?.jobType).toBe('jobType' in expected ? expected.jobType : undefined);
      expect([0, 1, 2, 3, 4, 6, 7].map((armor) => weapon?.damage[armor])).toEqual(expected.damage);
    }
  });

  it('retains each attack clip length and authored impact frames', () => {
    const attacks = [
      { tribeType: 5, jobType: 31, name: 'weresnake_soldier_attack', length: 32, impacts: [6, 10, 22] },
      { tribeType: 6, jobType: 31, name: 'werewolf_soldier_attack', length: 33, impacts: [6, 10, 22] },
      { tribeType: 8, jobType: 49, name: 'animal_bear_attack', length: 20, impacts: [6] },
      { tribeType: 18, jobType: 49, name: 'animal_bear_attack', length: 20, impacts: [6] },
      { tribeType: 20, jobType: 49, name: 'animal_wolve_attack', length: 25, impacts: [2] },
      { tribeType: 25, jobType: 49, name: 'animal_lion_male_attack', length: 25, impacts: [9] },
      { tribeType: 26, jobType: 49, name: 'animal_lion_female_attack', length: 25, impacts: [9] },
      { tribeType: 5, jobType: 35, name: 'animal_bear_attack', length: 20, impacts: [6] },
      { tribeType: 5, jobType: 33, name: 'animal_wolve_attack', length: 25, impacts: [2] },
      { tribeType: 5, jobType: 32, name: 'animal_lion_male_attack', length: 25, impacts: [9] },
      { tribeType: 5, jobType: 18, name: 'weresnake_chicken_attack', length: 50, impacts: [] },
      { tribeType: 5, jobType: 16, name: 'weresnake_chicken_attack', length: 50, impacts: [] },
    ] as const;
    for (const expected of attacks) {
      const tribe = content.tribes.find((row) => row.typeId === expected.tribeType);
      expect(tribe?.atomicBindings).toContainEqual({
        jobType: expected.jobType,
        atomicId: 81,
        animation: expected.name,
      });
      const clip = content.atomicAnimations.find((row) => row.id === expected.name);
      expect(clip?.length).toBe(expected.length);
      expect(clip?.events.filter((event) => event.type === 25).map((event) => event.at)).toEqual(
        expected.impacts,
      );
    }
  });
});
