import { describe, expect, it } from 'vitest';
import { Carrying, MoveGoal } from '../../../src/components/index.js';
import { Simulation } from '../../../src/index.js';
import { aiSystem } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';

import {
  buildingAt,
  cell,
  ctxOf,
  grassMap,
  HEADQUARTERS,
  pileAt,
  settlerAt,
  WOOD,
  WOODCUTTER,
} from './support.js';

describe('gatherer flag-drop — deliver harvested goods to a bound store', () => {
  it('a gatherer delivers to its bound flag pile rather than the nearest store', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(7, 1) });
    const flag = pileAt(sim, 6, 0); // its assigned drop flag (a bare ground pile), far
    buildingAt(sim, HEADQUARTERS, 1, 0); // a NEARER store it is not assigned to
    const cutter = settlerAt(sim, 3, 0, WOODCUTTER, flag);
    sim.world.add(cutter, Carrying, { goodType: WOOD, amount: 1 });

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(cutter, MoveGoal).cell).toBe(cell(sim, 6, 0)); // the flag, not the nearer HQ
  });

  it('an UNBOUND hauler still routes to the nearest store (the default, unchanged)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    buildingAt(sim, HEADQUARTERS, 4, 0);
    const cutter = settlerAt(sim, 0, 0, WOODCUTTER); // no JobAssignment
    sim.world.add(cutter, Carrying, { goodType: WOOD, amount: 1 });

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(cutter, MoveGoal).cell).toBe(cell(sim, 4, 0));
  });
});
