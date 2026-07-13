import { describe, expect, it } from 'vitest';
import { CurrentAtomic, Health, Settler } from '../../../../src/components/index.js';
import { Simulation } from '../../../../src/index.js';
import { atomicSystem, FIGHT_EXPERIENCE_TYPE, WEAPON_MAIN_TYPE } from '../../../../src/systems/index.js';
import {
  combatCadenceContent,
  ctxOf,
  fighterAt,
  grass,
  OTHER,
  SOLDIER_SPEAR,
  SOLDIER_UNARMED,
  startSwing,
  VIKING,
} from '../support.js';

describe('atomicSystem — a damaging swing accrues fight XP into the weapon-class bucket', () => {
  it('a spear swing accrues into the SPEAR fight bucket (the needfor-gate id space)', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
    startSwing(sim, attacker, { target, damage: 2090, hitAt: 1, weaponMainType: WEAPON_MAIN_TYPE.SPEAR }, 4);

    atomicSystem(sim.world, ctxOf(sim)); // the blow lands (frame 1) and trains the weapon class

    const xp = sim.world.get(attacker, Settler).experience;
    expect(xp.get(FIGHT_EXPERIENCE_TYPE.SPEAR)).toBe(1); // soldier-general factor 1 per swing
    expect(xp.get(FIGHT_EXPERIENCE_TYPE.SWORD)).toBeUndefined(); // only the spear bucket
  });

  it('maps each weapon class to its fight bucket (sword → SWORD, fist → FIST)', () => {
    const check = (mainType: number, bucket: number): void => {
      Settler.store.clear();
      Health.store.clear();
      CurrentAtomic.store.clear();
      const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
      const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_UNARMED);
      const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
      startSwing(sim, attacker, { target, damage: 100, hitAt: 1, weaponMainType: mainType }, 2);
      atomicSystem(sim.world, ctxOf(sim));
      expect(sim.world.get(attacker, Settler).experience.get(bucket)).toBe(1);
    };
    check(WEAPON_MAIN_TYPE.SWORD, FIGHT_EXPERIENCE_TYPE.SWORD);
    check(WEAPON_MAIN_TYPE.UNARMED, FIGHT_EXPERIENCE_TYPE.FIST);
  });

  it('trains nothing on a 0-damage swing, and nothing for a class with no fight track (saber)', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
    // A 0-damage swing (fully-absorbed / missed material) trains nothing.
    startSwing(sim, attacker, { target, damage: 0, hitAt: 1, weaponMainType: WEAPON_MAIN_TYPE.SPEAR }, 2);
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(attacker, Settler).experience.size).toBe(0);

    // A saber (no JOB_EXPERIENCE_TYPE_FIGHT_SABER in the data) trains no fight bucket even when it hits.
    startSwing(sim, attacker, { target, damage: 400, hitAt: 1, weaponMainType: WEAPON_MAIN_TYPE.SABER }, 2);
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(attacker, Settler).experience.size).toBe(0);
  });
});
