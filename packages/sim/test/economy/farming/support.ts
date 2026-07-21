export { ctxOf } from '../../fixtures/context.js';

import { grassCellMap as grassMap } from '../../fixtures/terrain.js';

export { grassMap };

import { type ContentSet, parseContentSet } from '@open-northland/data';
import * as components from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
  cellAnchorNode,
  fx,
  halfCellMapFromCells,
  ONE,
  positionOfNode,
  type Simulation,
  type TerrainMap,
} from '../../../src/index.js';
import { FIELD_FOOTPRINT, stampResourceFootprintData } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';

export const { Building, Carrying, Crop, GroundDrop, JobAssignment, Position, Resource, Settler, Stockpile } =
  components;

/**
 * FIELD FARMING (`systems/economy/farming.ts` + `agents/farming`): the farm's
 * sow→grow→water→reap→carry loop. Fixture: good 6 = wheat (atomics plant 34 / cultivate 35 / harvest 29
 * — the original's own ids; farming: 5 stages × 10 nominal ticks, yield 1, radius 8, 6 fields),
 * job 18 = farmer, building 5 = farm (4 farmer slots, wheat-only store cap 25, produces wheat, NO recipe).
 * Unit tests pin the growth/effect mechanics; planner passes pin each drive decision; the end-to-end
 * run proves wheat lands in the farm's own store, deterministically.
 */

export const GRASS = 0;
export const WHEAT = 6;
export const FARMER = 18;
export const FARM = 5;
export const VIKING = 1;
export const SOW_ATOMIC = 34;
export const WATER_ATOMIC = 35;
export const REAP_ATOMIC = 29;
export const PICKUP_ATOMIC = 22;
// The fixture's farming block (keep in sync with fixtures/content.ts).
export const STAGES = 5;
export const TICKS_PER_STAGE = 10;
/** The fixture farm's plot size — flat, whatever the crew (keep in sync with fixtures/content.ts). */
export const FIELD_CAP = 6;
const BARREN = 2;
const WATER = 1;
/** This suite's own walled type — see {@link wallsContent}; high enough to stay clear of the ids other
 *  suites append to the shared fixture. */
export const BLOCKHOUSE = 40;
const GRANARY = 6;
/** The fixture farm's wheat-slot ceiling (`stock` capacity 25 — keep in sync with fixtures/content.ts). */
export const FARM_WHEAT_CAP = 25;

/** A `width`×`height` CELL square of grass, upsampled to the half-cell navigation lattice. */

export function farmerAt(sim: Simulation, x: number, y: number, boundTo?: Entity): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: FARMER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  if (boundTo !== undefined) sim.world.add(e, JobAssignment, { workplace: boundTo });
  return e;
}

export function farmAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: FARM, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map() });
  return e;
}

/** Plant a field directly at tile (x, y) — the sow effect's output shape, for mid-lifecycle fixtures. */
export function fieldAt(
  sim: Simulation,
  farm: Entity,
  x: number,
  y: number,
  opts: { stage?: number; watered?: boolean } = {},
): Entity {
  const stage = opts.stage ?? 1;
  const ripe = stage >= STAGES;
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, { goodType: WHEAT, remaining: ripe ? 1 : 0, harvestAtomic: REAP_ATOMIC });
  stampResourceFootprintData(sim.world, e, FIELD_FOOTPRINT); // the shape applySow produces
  sim.world.add(e, Crop, {
    goodType: WHEAT,
    farm,
    stage,
    stages: STAGES,
    growth: 0,
    ticksPerStage: TICKS_PER_STAGE,
    watered: opts.watered ?? false,
    yieldUnits: 1,
  });
  return e;
}

/** {@link fieldAt} addressed by half-cell NODE instead of tile — for the nodes a building's walls cover
 *  that are not themselves cell anchors, which no tile-addressed helper can reach. */
export function fieldAtNode(
  sim: Simulation,
  farm: Entity,
  hx: number,
  hy: number,
  opts: { stage?: number; watered?: boolean } = {},
): Entity {
  const stage = opts.stage ?? 1;
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  sim.world.add(e, Resource, {
    goodType: WHEAT,
    remaining: stage >= STAGES ? 1 : 0,
    harvestAtomic: REAP_ATOMIC,
  });
  stampResourceFootprintData(sim.world, e, FIELD_FOOTPRINT); // the shape applySow produces
  sim.world.add(e, Crop, {
    goodType: WHEAT,
    farm,
    stage,
    stages: STAGES,
    growth: 0,
    ticksPerStage: TICKS_PER_STAGE,
    watered: opts.watered ?? false,
    yieldUnits: 1,
  });
  return e;
}

/** A cell map where matching cells are plantable grass and the remainder is barren terrain. */
export function mapWithBarren(
  width: number,
  height: number,
  isGrass: (x: number, y: number) => boolean,
): TerrainMap {
  const typeIds: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) typeIds.push(isGrass(x, y) ? GRASS : BARREN);
  }
  return halfCellMapFromCells({ width, height, typeIds });
}

/** A cell map built from a per-cell terrain choice — `'grass'` (walkable, plantable), `'barren'`
 *  (walkable, never plantable) or `'water'` (unwalkable, so it splits static terrain components). */
export function cellMap(
  width: number,
  height: number,
  typeAt: (x: number, y: number) => 'grass' | 'barren' | 'water',
): TerrainMap {
  const byName = { grass: GRASS, barren: BARREN, water: WATER } as const;
  const typeIds: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) typeIds.push(byName[typeAt(x, y)]);
  }
  return halfCellMapFromCells({ width, height, typeIds });
}

/** The base fixture plus ONE walled type — a 2×2 walk-blocking body on its anchor, no door. Every other
 *  fixture building blocks nothing, so without this no farming test could express a building standing over
 *  ground. Kept local to this suite (like the placement suite's own `hut`) rather than added to the shared
 *  fixture, whose building ids other suites extend with their own. */
export function wallsContent(): ContentSet {
  const base = testContent();
  const body = [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
  ];
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      {
        typeId: BLOCKHOUSE,
        id: 'blockhouse',
        kind: 'storage',
        footprint: { blocked: body, familyBody: body, reserved: body },
      },
    ],
  });
}

/** Raise a {@link wallsContent} blockhouse at tile (x, y), skipping the ground-collision gate — these
 *  cases are about what standing walls do to a plot, not about which sites the gate accepts. */
export function blockhouseAt(sim: Simulation, x: number, y: number): void {
  const node = cellAnchorNode(x, y);
  sim.enqueue({
    kind: 'placeBuilding',
    buildingType: BLOCKHOUSE,
    x: node.hx,
    y: node.hy,
    tribe: VIKING,
    force: true,
  });
  sim.run(1);
}

export function granaryAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: GRANARY, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map() });
  return e;
}
