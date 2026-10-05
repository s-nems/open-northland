import { describe, expect, it } from 'vitest';
import { Building, FarmAnimal, Livestock, MoveGoal, Owner, StayPoint } from '../../src/components/index.js';
import { ZERO } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  FARM_HERD_LEASH_NODES,
  LIVESTOCK_GRAZE_RANGE_NODES,
  livestockAssignmentSystem,
} from '../../src/systems/index.js';
import { BEAR_TRIBE, cowAt, ctxOf, farmAt, HEADQUARTERS, livestockSim } from './support.js';

const P0 = 0;
const P1 = 1;
const WAREHOUSE = 7;
const WORKSHOP = 2;

/** Node Manhattan from an animal's StayPoint anchor to the door at (hx, hy) - the fixture buildings
 *  carry no door footprint, so the interaction node IS the anchor node. */
function anchorDistance(sim: ReturnType<typeof livestockSim>, e: Entity, hx: number, hy: number): number {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('livestockSim always has a map');
  const cell = sim.world.tryGet(e, StayPoint)?.cell;
  if (cell === undefined) return Number.POSITIVE_INFINITY;
  const door = terrain.coordsOf(terrain.nodeAt(hx, hy));
  const spot = terrain.coordsOf(cell);
  return Math.abs(spot.x - door.x) + Math.abs(spot.y - door.y);
}

/** Beside the door - on the ring of home spots, never in the doorway itself. */
function onRing(distance: number): boolean {
  return distance > 0 && distance <= LIVESTOCK_GRAZE_RANGE_NODES;
}

describe('livestock assignment - a herd keeps to its farm, loose stock to the base yard', () => {
  it("anchors a farm's animal on the farm door, the original's birth point for the herd", () => {
    const sim = livestockSim();
    const farm = farmAt(sim, 20, 20, { owner: P0 });
    const cow = cowAt(sim, 4, 4, { owner: P0, farm });

    livestockAssignmentSystem(sim.world, ctxOf(sim)); // tick 0 - the period fires

    expect(anchorDistance(sim, cow, 20, 20)).toBe(0);
  });

  it('walks a farm animal home to a spot beside the door, never into the doorway', () => {
    const sim = livestockSim();
    const farm = farmAt(sim, 20, 20, { owner: P0 });
    const cow = cowAt(sim, 4, 4, { owner: P0, farm });

    livestockAssignmentSystem(sim.world, ctxOf(sim));

    const goal = sim.world.get(cow, MoveGoal).cell;
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('livestockSim always has a map');
    const door = terrain.coordsOf(terrain.nodeAt(20, 20));
    const spot = terrain.coordsOf(goal);
    expect(onRing(Math.abs(spot.x - door.x) + Math.abs(spot.y - door.y))).toBe(true);
  });

  it('leaves a farm animal inside the 15-node leash where it grazes', () => {
    const sim = livestockSim();
    const farm = farmAt(sim, 20, 20, { owner: P0 });
    const grazing = cowAt(sim, 20 + FARM_HERD_LEASH_NODES, 20, { owner: P0, farm });
    const strayed = cowAt(sim, 20 + FARM_HERD_LEASH_NODES + 2, 20, { owner: P0, farm });

    livestockAssignmentSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(grazing, MoveGoal)).toBe(false);
    expect(sim.world.has(strayed, MoveGoal)).toBe(true);
  });

  it('releases a herd whose farm is gone, and sends it to the base yard', () => {
    const sim = livestockSim();
    const farm = farmAt(sim, 20, 20, { owner: P0 });
    farmAt(sim, 24, 24, { owner: P0, buildingType: HEADQUARTERS });
    const cow = cowAt(sim, 4, 4, { owner: P0, farm });
    sim.world.destroy(farm);

    livestockAssignmentSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(cow, FarmAnimal)).toBe(false);
    expect(onRing(anchorDistance(sim, cow, 24, 24))).toBe(true);
  });

  it('rings the headquarters with the stock no farm holds; same-yard members take distinct spots', () => {
    const sim = livestockSim();
    farmAt(sim, 24, 24, { owner: P0, buildingType: HEADQUARTERS });
    const first = cowAt(sim, 4, 4, { owner: P0 });
    const second = cowAt(sim, 5, 4, { owner: P0 });

    livestockAssignmentSystem(sim.world, ctxOf(sim));

    expect(onRing(anchorDistance(sim, first, 24, 24))).toBe(true);
    expect(onRing(anchorDistance(sim, second, 24, 24))).toBe(true);
    expect(sim.world.get(second, StayPoint).cell).not.toBe(sim.world.get(first, StayPoint).cell);
  });

  it("never anchors onto another player's base; with nothing of its own the leash stays put", () => {
    const sim = livestockSim();
    farmAt(sim, 24, 24, { owner: P1, buildingType: HEADQUARTERS });
    const cow = cowAt(sim, 4, 4, { owner: P0 });

    livestockAssignmentSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(cow, StayPoint)).toBe(false);
  });

  it('keeps headquarters ahead of a nearer warehouse or workshop', () => {
    const sim = livestockSim();
    farmAt(sim, 40, 40, { owner: P0, buildingType: HEADQUARTERS });
    farmAt(sim, 15, 15, { owner: P0, buildingType: WAREHOUSE });
    farmAt(sim, 10, 10, { owner: P0, buildingType: WORKSHOP });
    const cow = cowAt(sim, 4, 4, { owner: P0 });

    livestockAssignmentSystem(sim.world, ctxOf(sim));

    expect(onRing(anchorDistance(sim, cow, 40, 40))).toBe(true);
  });

  it('without headquarters each animal chooses its nearest warehouse, ahead of a closer workshop', () => {
    const sim = livestockSim();
    farmAt(sim, 12, 12, { owner: P0, buildingType: WAREHOUSE });
    farmAt(sim, 48, 48, { owner: P0, buildingType: WAREHOUSE });
    farmAt(sim, 54, 54, { owner: P0, buildingType: WORKSHOP });
    const west = cowAt(sim, 4, 4, { owner: P0 });
    const east = cowAt(sim, 58, 58, { owner: P0 });

    livestockAssignmentSystem(sim.world, ctxOf(sim));

    expect(onRing(anchorDistance(sim, west, 12, 12))).toBe(true);
    expect(onRing(anchorDistance(sim, east, 48, 48))).toBe(true);
    for (const animal of [west, east]) {
      expect(sim.world.get(animal, MoveGoal).cell).toBe(sim.world.get(animal, StayPoint).cell);
    }
  });

  it('without storage chooses the nearest finished owned building', () => {
    const sim = livestockSim();
    farmAt(sim, 48, 48, { owner: P0, buildingType: WORKSHOP });
    farmAt(sim, 20, 20, { owner: P0, buildingType: WORKSHOP });
    farmAt(sim, 5, 5, { owner: P1, buildingType: WAREHOUSE });
    farmAt(sim, 6, 6, { owner: P1, buildingType: WORKSHOP });
    const unfinished = farmAt(sim, 8, 8, { owner: P0, buildingType: WAREHOUSE });
    sim.world.mut(unfinished, Building).built = ZERO;
    const cow = cowAt(sim, 4, 4, { owner: P0 });

    livestockAssignmentSystem(sim.world, ctxOf(sim));

    expect(onRing(anchorDistance(sim, cow, 20, 20))).toBe(true);
    expect(sim.world.get(cow, MoveGoal).cell).toBe(sim.world.get(cow, StayPoint).cell);
  });

  it('breaks equal-distance warehouse ties by entity id, irrespective of component insertion order', () => {
    const sim = livestockSim();
    const first = farmAt(sim, 10, 30, { owner: P0, buildingType: WAREHOUSE });
    farmAt(sim, 30, 10, { owner: P0, buildingType: WAREHOUSE });
    sim.world.remove(first, Owner);
    sim.world.add(first, Owner, { player: P0 });
    const cow = cowAt(sim, 4, 4, { owner: P0 });

    livestockAssignmentSystem(sim.world, ctxOf(sim));

    expect(onRing(anchorDistance(sim, cow, 10, 30))).toBe(true);
  });

  it('retargets after demolition and ownership changes, retaining the last spot with no building left', () => {
    const sim = livestockSim();
    const hq = farmAt(sim, 40, 40, { owner: P0, buildingType: HEADQUARTERS });
    const store = farmAt(sim, 25, 25, { owner: P0, buildingType: WAREHOUSE });
    const workshop = farmAt(sim, 15, 15, { owner: P0, buildingType: WORKSHOP });
    const cow = cowAt(sim, 4, 4, { owner: P0 });
    livestockAssignmentSystem(sim.world, ctxOf(sim));
    expect(onRing(anchorDistance(sim, cow, 40, 40))).toBe(true);

    sim.world.destroy(hq);
    livestockAssignmentSystem(sim.world, ctxOf(sim));
    expect(onRing(anchorDistance(sim, cow, 25, 25))).toBe(true);

    sim.world.mut(store, Owner).player = P1;
    livestockAssignmentSystem(sim.world, ctxOf(sim));
    expect(onRing(anchorDistance(sim, cow, 15, 15))).toBe(true);

    const lastSpot = sim.world.get(cow, StayPoint).cell;
    sim.world.destroy(workshop);
    livestockAssignmentSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(cow, StayPoint).cell).toBe(lastSpot);
  });

  it('marches a loose straggler home at the yard leash, not its species territory radius', () => {
    const sim = livestockSim();
    farmAt(sim, 24, 24, { owner: P0, buildingType: HEADQUARTERS });
    // A species with a WIDE territory (the fixture bear, stayPointRange 6), claimed by hand: standing
    // 5 nodes from its yard spot - inside the species radius, beyond the 3-node yard leash - it must
    // still be walked back.
    const straggler = cowAt(sim, 30, 27, { owner: P0, tribe: BEAR_TRIBE });
    sim.world.add(straggler, Livestock, {});

    livestockAssignmentSystem(sim.world, ctxOf(sim));

    expect(onRing(anchorDistance(sim, straggler, 24, 24))).toBe(true);
    expect(sim.world.get(straggler, MoveGoal).cell).toBe(sim.world.get(straggler, StayPoint).cell);
  });

  it('leaves an animal summoned for slaughter alone - the summon owns its feet', () => {
    const sim = livestockSim();
    const farm = farmAt(sim, 20, 20, { owner: P0 });
    const cow = cowAt(sim, 4, 4, { owner: P0, farm });
    sim.world.mut(cow, FarmAnimal).summoner = farm; // stand-in for the breeder leading it in

    livestockAssignmentSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(cow, StayPoint)).toBe(false);
    expect(sim.world.has(cow, MoveGoal)).toBe(false);
  });

  it('leaves wild animals untouched', () => {
    const sim = livestockSim();
    farmAt(sim, 20, 20, { owner: P0 });
    const wild = cowAt(sim, 4, 4);

    livestockAssignmentSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(wild, StayPoint)).toBe(false);
  });
});
