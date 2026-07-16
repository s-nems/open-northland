import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/index.js';
import { SYSTEM_ORDER } from '../../src/systems/schedule.js';
import { testContent } from '../fixtures/content.js';
import { grassNodeMap as grassMap } from '../fixtures/terrain.js';

const HEADQUARTERS = 1;
const WOODCUTTER = 1;
const VIKING = 1;
const TICKS = 40;

/** A working run (a building + a settler on a real map) so the systems do non-trivial work. */
function runSim(instrumented: boolean): { sim: Simulation; calls: string[] } {
  const sim = new Simulation({ seed: 7, content: testContent(), map: grassMap(6, 1) });
  const calls: string[] = [];
  if (instrumented) {
    sim.setInstrument((name, run) => {
      calls.push(name);
      run();
    });
  }
  sim.enqueue({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 5, y: 0, tribe: VIKING });
  sim.enqueue({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 1, y: 0, tribe: VIKING });
  for (let i = 0; i < TICKS; i++) sim.step();
  return { sim, calls };
}

describe('Simulation.setInstrument', () => {
  it('is purely observational: an instrumented run hashes byte-identically to a bare one', () => {
    const bare = runSim(false);
    const instrumented = runSim(true);
    expect(instrumented.sim.hashState()).toBe(bare.sim.hashState());
  });

  it('wraps every scheduled system each tick, in schedule order', () => {
    const { calls } = runSim(true);
    const scheduleNames = SYSTEM_ORDER.map((s) => s.name);
    expect(calls).toHaveLength(scheduleNames.length * TICKS);
    expect(calls.slice(0, scheduleNames.length)).toEqual(scheduleNames);
  });

  it('can be cleared: later ticks run direct again', () => {
    const sim = new Simulation({ seed: 7, content: testContent() });
    const calls: string[] = [];
    sim.setInstrument((name, run) => {
      calls.push(name);
      run();
    });
    sim.step();
    const afterOneTick = calls.length;
    sim.setInstrument(null);
    sim.step();
    expect(afterOneTick).toBeGreaterThan(0);
    expect(calls).toHaveLength(afterOneTick);
  });
});
