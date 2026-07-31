import { describe, expect, it } from 'vitest';
import { Livestock, LivestockVisit, MoveGoal, StayPoint } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { LIVESTOCK_GRAZE_RANGE_NODES, livestockAssignmentSystem } from '../../src/systems/index.js';
import { BEAR_TRIBE, cowAt, ctxOf, farmAt, HEADQUARTERS, livestockSim } from './support.js';

const P0 = 0;
const P1 = 1;

/** Node Manhattan from an animal's StayPoint anchor to the door at (hx, hy) - the fixture buildings
 *  carry no door footprint, so the interaction node IS the anchor node. */
function ringDistance(sim: ReturnType<typeof livestockSim>, e: Entity, hx: number, hy: number): number {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('livestockSim always has a map');
  const cell = sim.world.tryGet(e, StayPoint)?.cell;
  if (cell === undefined) return Number.POSITIVE_INFINITY;
  const door = terrain.coordsOf(terrain.nodeAt(hx, hy));
  const spot = terrain.coordsOf(cell);
  return Math.abs(spot.x - door.x) + Math.abs(spot.y - door.y);
}

/** Beside the door - on the grazing ring, never in the doorway itself. */
function onRing(distance: number): boolean {
  return distance > 0 && distance <= LIVESTOCK_GRAZE_RANGE_NODES;
}

describe('livestock assignment - claimed stock grazes on a ring around farms or the HQ', () => {
  it('anchors an owned cow onto a spot beside its player-built farm door, not the doorway', () => {
    const sim = livestockSim();
    farmAt(sim, 20, 20, { owner: P0 });
    const cow = cowAt(sim, 4, 4, { owner: P0 });

    livestockAssignmentSystem(sim.world, ctxOf(sim)); // tick 0 - the period fires

    expect(onRing(ringDistance(sim, cow, 20, 20))).toBe(true);
  });

  it('splits the herd round-robin across two farms; same-farm members take distinct spots', () => {
    const sim = livestockSim();
    farmAt(sim, 20, 20, { owner: P0 });
    farmAt(sim, 40, 40, { owner: P0 });
    const first = cowAt(sim, 4, 4, { owner: P0 });
    const second = cowAt(sim, 5, 4, { owner: P0 });
    const third = cowAt(sim, 6, 4, { owner: P0 });

    livestockAssignmentSystem(sim.world, ctxOf(sim));

    expect(onRing(ringDistance(sim, first, 20, 20))).toBe(true);
    expect(onRing(ringDistance(sim, second, 40, 40))).toBe(true);
    expect(onRing(ringDistance(sim, third, 20, 20))).toBe(true);
    expect(sim.world.get(third, StayPoint).cell).not.toBe(sim.world.get(first, StayPoint).cell);
  });

  it('falls back to the headquarters while no farm stands', () => {
    const sim = livestockSim();
    farmAt(sim, 24, 24, { owner: P0, buildingType: HEADQUARTERS });
    const cow = cowAt(sim, 4, 4, { owner: P0 });

    livestockAssignmentSystem(sim.world, ctxOf(sim));

    expect(onRing(ringDistance(sim, cow, 24, 24))).toBe(true);
  });

  it("never anchors onto another player's farm; with nothing of its own the leash stays put", () => {
    const sim = livestockSim();
    farmAt(sim, 20, 20, { owner: P1 });
    const cow = cowAt(sim, 4, 4, { owner: P0 });

    livestockAssignmentSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(cow, StayPoint)).toBe(false);
  });

  it('marches a straggler home at the grazing leash, not its species territory radius', () => {
    const sim = livestockSim();
    farmAt(sim, 20, 20, { owner: P0 });
    // A species with a WIDE territory (the fixture bear, stayPointRange 6), claimed by hand: standing
    // 5 nodes from its ring anchor - inside the species radius, beyond the 3-node grazing leash - it
    // must still be walked onto the anchor.
    const straggler = cowAt(sim, 26, 23, { owner: P0, tribe: BEAR_TRIBE });
    sim.world.add(straggler, Livestock, {});

    livestockAssignmentSystem(sim.world, ctxOf(sim));

    expect(onRing(ringDistance(sim, straggler, 20, 20))).toBe(true);
    expect(sim.world.get(straggler, MoveGoal).cell).toBe(sim.world.get(straggler, StayPoint).cell);
  });

  it('leaves an animal already inside the grazing leash standing', () => {
    const sim = livestockSim();
    farmAt(sim, 20, 20, { owner: P0 });
    // 2 nodes from the ring anchor the sweep hands it - inside the leash, so no march goal.
    const settled = cowAt(sim, 24, 22, { owner: P0, tribe: BEAR_TRIBE });
    sim.world.add(settled, Livestock, {});

    livestockAssignmentSystem(sim.world, ctxOf(sim));

    expect(onRing(ringDistance(sim, settled, 20, 20))).toBe(true);
    expect(sim.world.has(settled, MoveGoal)).toBe(false);
  });

  it('leaves a booked visitor alone - herding resumes when the batch releases it', () => {
    const sim = livestockSim();
    const farm = farmAt(sim, 20, 20, { owner: P0 });
    const cow = cowAt(sim, 4, 4, { owner: P0 });
    sim.world.add(cow, LivestockVisit, { at: farm });

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
