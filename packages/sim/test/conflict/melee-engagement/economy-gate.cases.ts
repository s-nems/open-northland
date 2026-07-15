import { describe, expect, it } from 'vitest';
import { CurrentAtomic, Engagement, Position, Resource } from '../../../src/components/index.js';
import { fx, Simulation } from '../../../src/index.js';
import { aiSystem } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf, fighterAt, grassMap, HARVEST_ATOMIC, P0, VIKING, WOOD, WOODCUTTER } from './support.js';

describe('engagement gates the economy (the PlayerOrder-skip pattern)', () => {
  /** A harvestable wood node (a separate entity) at (x,y). */
  function woodAt(sim: Simulation, x: number, y: number): void {
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
    sim.world.add(e, Resource, { goodType: WOOD, remaining: 5, harvestAtomic: HARVEST_ATOMIC });
  }

  it('an ENGAGED combatant skips economy planning (does not harvest a resource it stands on)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const cutter = fighterAt(sim, 3, 0, VIKING, WOODCUTTER, { owner: P0 });
    woodAt(sim, 3, 0); // a wood node on the cutter's tile — it would normally start chopping
    sim.world.add(cutter, Engagement, { repathAt: sim.tick });

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(cutter, CurrentAtomic)).toBe(false); // engaged — the economy did NOT start a harvest
  });

  it('the SAME woodcutter harvests when NOT engaged (proving the gate is what stopped it)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const cutter = fighterAt(sim, 3, 0, VIKING, WOODCUTTER, { owner: P0 });
    woodAt(sim, 3, 0);

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(cutter, CurrentAtomic).atomicId).toBe(HARVEST_ATOMIC); // economy ran — it harvested
  });
});
