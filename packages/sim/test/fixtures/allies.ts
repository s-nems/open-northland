import type { Simulation } from '../../src/index.js';

/** Turn allied vision on and make `a` and `b` mutual friends, so they share one fog mask. */
export function allyVision(sim: Simulation, a: number, b: number): void {
  sim.enqueueSetup({ kind: 'setAlliedVision', enabled: true });
  sim.enqueueSetup({ kind: 'setDiplomacy', from: a, to: b, state: 'friend' });
  sim.enqueueSetup({ kind: 'setDiplomacy', from: b, to: a, state: 'friend' });
}
