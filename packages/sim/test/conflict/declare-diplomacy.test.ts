import { describe, expect, it } from 'vitest';
import {
  type DiplomacyState,
  diplomacyStance,
  Health,
  setDiplomacyLock,
} from '../../src/components/index.js';
import { playerCommand, Simulation } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { fighterAt, grassMap, P0, P1, VIKING, WOODCUTTER } from './melee-engagement/support.js';

/**
 * A seat's own stance change, the command the diplomacy window's stance buttons send: it rewrites the
 * seat's direction of the pair only, and a locked pair or another seat's stance is refused.
 */

const TICKS = 60;

/** Two neighbours that start neutral toward each other, as a map's unset roster pair does. */
function neutralNeighbours() {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
  const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0, hitpoints: 1_000_000 });
  const b = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P1, hitpoints: 1_000_000 });
  sim.enqueueSetup({ kind: 'setDiplomacy', from: P0, to: P1, state: 'neutral' });
  sim.enqueueSetup({ kind: 'setDiplomacy', from: P1, to: P0, state: 'neutral' });
  sim.step();
  return { sim, a, b };
}

/** `seat` declares its stance toward the other neighbour and the command applies. */
function declare(sim: Simulation, seat: number, state: DiplomacyState): void {
  const other = seat === P0 ? P1 : P0;
  sim.enqueue(playerCommand(seat, { kind: 'declareDiplomacy', player: seat, other, state }));
  sim.step();
}

describe('declareDiplomacy', () => {
  it("sets the seat's own direction only, and an attack order on the new enemy then lands", () => {
    const { sim, a, b } = neutralNeighbours();
    sim.enqueue(playerCommand(P0, { kind: 'attackUnit', entity: a, target: b }));
    for (let i = 0; i < TICKS; i++) sim.step();
    expect(sim.world.get(b, Health).hitpoints).toBe(sim.world.get(b, Health).max); // refused while neutral

    declare(sim, P0, 'enemy');
    expect(diplomacyStance(sim.world, P0, P1)).toBe('enemy');
    expect(diplomacyStance(sim.world, P1, P0)).toBe('neutral');

    sim.enqueue(playerCommand(P0, { kind: 'attackUnit', entity: a, target: b }));
    let lowest = sim.world.get(b, Health).hitpoints;
    for (let i = 0; i < TICKS; i++) {
      sim.step();
      lowest = Math.min(lowest, sim.world.get(b, Health).hitpoints);
    }
    expect(lowest).toBeLessThan(sim.world.get(b, Health).max);
  });

  it('refuses a pair the map or a script locked, in either direction', () => {
    const { sim } = neutralNeighbours();
    setDiplomacyLock(sim.world, P1, P0, true);
    declare(sim, P0, 'enemy');
    declare(sim, P1, 'friend');
    expect(diplomacyStance(sim.world, P0, P1)).toBe('neutral');
    expect(diplomacyStance(sim.world, P1, P0)).toBe('neutral');
  });

  it("refuses a seat that names another seat's stance", () => {
    const { sim } = neutralNeighbours();
    sim.enqueue(playerCommand(P1, { kind: 'declareDiplomacy', player: P0, other: P1, state: 'enemy' }));
    sim.step();
    expect(diplomacyStance(sim.world, P0, P1)).toBe('neutral');
  });
});
