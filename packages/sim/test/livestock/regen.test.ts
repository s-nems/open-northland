import { describe, expect, it } from 'vitest';
import { Health, Owner } from '../../src/components/index.js';
import { positionOfNode } from '../../src/index.js';
import { LIVESTOCK_REGEN_HP_PER_TICK, livestockRegenSystem } from '../../src/systems/index.js';
import { settlerAt } from '../fixtures/settler.js';
import { COW_HP, cowAt, ctxOf, livestockSim } from './support.js';

const P0 = 0;

describe('livestock regen - claimed animals heal back the processing drain', () => {
  it('heals an owned cow below its pool, capped at max', () => {
    const sim = livestockSim();
    const cow = cowAt(sim, 4, 4, { owner: P0, hp: COW_HP / 2 });

    livestockRegenSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(cow, Health).hitpoints).toBe(COW_HP / 2 + LIVESTOCK_REGEN_HP_PER_TICK);

    sim.world.write(cow, Health, (h) => {
      h.hitpoints = COW_HP;
    });
    livestockRegenSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(cow, Health).hitpoints).toBe(COW_HP);
  });

  it('never heals wild animals or owned humans', () => {
    const sim = livestockSim();
    const wild = cowAt(sim, 4, 4, { hp: COW_HP / 2 });
    const human = settlerAt(sim, { jobType: 1, position: positionOfNode(6, 6) });
    sim.world.add(human, Owner, { player: P0 });
    sim.world.add(human, Health, { hitpoints: 400, max: 1000 });

    livestockRegenSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(wild, Health).hitpoints).toBe(COW_HP / 2);
    expect(sim.world.get(human, Health).hitpoints).toBe(400);
  });
});
