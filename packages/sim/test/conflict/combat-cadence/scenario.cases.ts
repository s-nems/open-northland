import { describe, expect, it } from 'vitest';
import { Armor, CurrentAtomic, Health, Position, Settler } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import { FIGHT_EXPERIENCE_TYPE } from '../../../src/systems/index.js';
import {
  combatCadenceContent,
  fighterAt,
  grass,
  PLATE_CLASS,
  SAXON,
  SOLDIER_SPEAR,
  VIKING,
} from './support.js';

describe('two squads exchange blows at the data cadence (extended headless scenario)', () => {
  function seedSquads(sim: Simulation): { vikings: Entity[]; saxons: Entity[] } {
    // Two spear squads, interleaved within reach, on a small line — adjacent cells are 2 nodes apart
    // (inside the spear band [1,2]), so each viking has a saxon in range and back.
    const vikings = [
      fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR, { hitpoints: 20_000 }),
      fighterAt(sim, 2, 0, VIKING, SOLDIER_SPEAR, { hitpoints: 20_000 }),
    ];
    const saxons = [
      fighterAt(sim, 1, 0, SAXON, SOLDIER_SPEAR, { hitpoints: 20_000, armorClass: PLATE_CLASS }),
      fighterAt(sim, 3, 0, SAXON, SOLDIER_SPEAR, { hitpoints: 20_000, armorClass: PLATE_CLASS }),
    ];
    return { vikings, saxons };
  }

  it('both squads land blows, accrue fight XP, and tire — through the real step() schedule', () => {
    const sim = new Simulation({ seed: 3, content: combatCadenceContent(), map: grass(4, 1) });
    const { vikings, saxons } = seedSquads(sim);
    for (let i = 0; i < 60; i++) sim.step();

    // Both sides took damage (a mutual exchange), and the plate-armored saxons took the spear's anti-plate
    // column (2090/hit) while the unarmored vikings took the full 3800.
    expect(sim.world.get(saxons[0], Health).hitpoints).toBeLessThan(20_000);
    expect(sim.world.get(vikings[0], Health).hitpoints).toBeLessThan(20_000);
    // A surviving spearman accrued SPEAR fight XP (the needfor-gate bucket) and tired from swinging.
    const anyViking = vikings.find((v) => sim.world.isAlive(v) && sim.world.has(v, Settler));
    if (anyViking !== undefined) {
      expect(
        sim.world.get(anyViking, Settler).experience.get(FIGHT_EXPERIENCE_TYPE.SPEAR) ?? 0,
      ).toBeGreaterThan(0);
      expect(sim.world.get(anyViking, Settler).fatigue).toBeGreaterThan(0);
    }
  });

  it('is deterministic — two same-seed runs of the skirmish reach the same state hash', () => {
    const run = (): string => {
      Position.store.clear();
      Settler.store.clear();
      Health.store.clear();
      Armor.store.clear();
      CurrentAtomic.store.clear();
      const sim = new Simulation({ seed: 7, content: combatCadenceContent(), map: grass(4, 1) });
      seedSquads(sim);
      for (let i = 0; i < 80; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
