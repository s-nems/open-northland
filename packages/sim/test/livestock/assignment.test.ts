import { describe, expect, it } from 'vitest';
import { StayPoint } from '../../src/components/index.js';
import { livestockAssignmentSystem } from '../../src/systems/index.js';
import { cowAt, ctxOf, farmAt, HEADQUARTERS, livestockSim } from './support.js';

const P0 = 0;
const P1 = 1;

/** The fixture buildings carry no door footprint, so the interaction node IS the anchor node. */
function nodeAt(sim: ReturnType<typeof livestockSim>, hx: number, hy: number): number {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('livestockSim always has a map');
  return terrain.nodeAt(hx, hy);
}

describe('livestock assignment - claimed stock re-anchors onto farms or the HQ', () => {
  it('anchors an owned cow onto its player-built farm door', () => {
    const sim = livestockSim();
    farmAt(sim, 20, 20, { owner: P0 });
    const cow = cowAt(sim, 4, 4, { owner: P0 });

    livestockAssignmentSystem(sim.world, ctxOf(sim)); // tick 0 - the period fires

    expect(sim.world.tryGet(cow, StayPoint)?.cell).toBe(nodeAt(sim, 20, 20));
  });

  it('splits the herd round-robin across two farms in canonical order', () => {
    const sim = livestockSim();
    farmAt(sim, 20, 20, { owner: P0 });
    farmAt(sim, 40, 40, { owner: P0 });
    const first = cowAt(sim, 4, 4, { owner: P0 });
    const second = cowAt(sim, 5, 4, { owner: P0 });
    const third = cowAt(sim, 6, 4, { owner: P0 });

    livestockAssignmentSystem(sim.world, ctxOf(sim));

    expect(sim.world.tryGet(first, StayPoint)?.cell).toBe(nodeAt(sim, 20, 20));
    expect(sim.world.tryGet(second, StayPoint)?.cell).toBe(nodeAt(sim, 40, 40));
    expect(sim.world.tryGet(third, StayPoint)?.cell).toBe(nodeAt(sim, 20, 20));
  });

  it('falls back to the headquarters while no farm stands', () => {
    const sim = livestockSim();
    farmAt(sim, 24, 24, { owner: P0, buildingType: HEADQUARTERS });
    const cow = cowAt(sim, 4, 4, { owner: P0 });

    livestockAssignmentSystem(sim.world, ctxOf(sim));

    expect(sim.world.tryGet(cow, StayPoint)?.cell).toBe(nodeAt(sim, 24, 24));
  });

  it("never anchors onto another player's farm; with nothing of its own the leash stays put", () => {
    const sim = livestockSim();
    farmAt(sim, 20, 20, { owner: P1 });
    const cow = cowAt(sim, 4, 4, { owner: P0 });

    livestockAssignmentSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(cow, StayPoint)).toBe(false);
  });

  it('leaves wild animals untouched', () => {
    const sim = livestockSim();
    farmAt(sim, 20, 20, { owner: P0 });
    const wild = cowAt(sim, 4, 4);

    livestockAssignmentSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(wild, StayPoint)).toBe(false);
  });
});
