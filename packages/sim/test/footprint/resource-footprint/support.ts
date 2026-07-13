import { expect } from 'vitest';
import { GroundDrop, Position, Resource, Settler, Stockpile } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, halfCellMapFromCells, positionOfNode, Simulation, type TerrainMap } from '../../../src/index.js';
import type { NodeId, TerrainGraph } from '../../../src/nav/terrain/index.js';
import { type SystemContext, stampResourceFootprint } from '../../../src/systems/index.js';
import { content, GRASS, VIKING, WOODCUTTER } from './content.js';

export function grassMap(width: number, height: number): TerrainMap {
  // Cell-dims signature; the sim's graph is the upsampled 2W×2H half-cell lattice. All scenario
  // coordinates below are NODE coords on that lattice (the LandscapeGfx area offsets always were —
  // the source's LogicWalkBlockArea/LogicBuildBlockArea address the original's 2W×2H grid).
  return halfCellMapFromCells({ width, height, typeIds: new Array(width * height).fill(GRASS) });
}

export function mappedSim(map: TerrainMap = grassMap(10, 5)): Simulation {
  return new Simulation({ seed: 1, content: content(), map });
}

export function terrainOf(sim: Simulation): TerrainGraph {
  if (sim.terrain === undefined) throw new Error('mapped sim expected');
  return sim.terrain;
}

export function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: sim.tick,
    events: sim.events,
    commands: sim.commands,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

/** A stamped resource node anchored at half-cell NODE (x,y). */
export function placeResource(
  sim: Simulation,
  goodType: number,
  harvestAtomic: number,
  x: number,
  y: number,
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(x, y));
  sim.world.add(e, Resource, { goodType, remaining: 3, harvestAtomic });
  expect(stampResourceFootprint(sim.world, sim.content, e, goodType)).toBe(true);
  return e;
}

/** A settler standing exactly on half-cell NODE (x,y). */
export function placeSettler(sim: Simulation, jobType: number, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(x, y));
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  return e;
}

export function placeWoodcutter(sim: Simulation, x: number, y: number): Entity {
  return placeSettler(sim, WOODCUTTER, x, y);
}

/** A loose ground drop lying on half-cell NODE (x,y). */
export function placeGroundDrop(
  sim: Simulation,
  goodType: number,
  amount: number,
  x: number,
  y: number,
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(x, y));
  sim.world.add(e, Stockpile, { amounts: new Map([[goodType, amount]]) });
  sim.world.add(e, GroundDrop, { goodType });
  return e;
}

export function coords(
  terrain: TerrainGraph,
  path: readonly NodeId[] | null,
): Array<{ x: number; y: number }> {
  if (path === null) return [];
  return path.map((cell) => terrain.coordsOf(cell));
}
