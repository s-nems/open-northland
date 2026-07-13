import { beforeEach } from 'vitest';
import * as components from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, halfCellMapFromCells, ONE, type Simulation, type TerrainMap } from '../../../src/index.js';
import type { SystemContext } from '../../../src/systems/index.js';
import { clearComponentStores } from '../../fixtures/stores.js';

export const { Building, Carrying, Crop, GroundDrop, JobAssignment, Position, Resource, Settler, Stockpile } =
  components;

/**
 * FIELD FARMING (`systems/economy/farming.ts` + `agents/farming`): the farm's
 * sow→grow→water→reap→carry loop. Fixture: good 6 = wheat (atomics plant 34 / cultivate 35 / harvest 29
 * — the original's own ids; farming: 5 stages × 10 ticks, yield 1, radius 8, field cap 2 + 4/farmer),
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
/** The fixture's field-cap formula: `fieldsBase + fieldsPerFarmer × bound field-farmers`. */
export const FIELDS_BASE = 2;
export const FIELDS_PER_FARMER = 4;
export const SOLO_FIELD_CAP = FIELDS_BASE + FIELDS_PER_FARMER; // 6
export const PAIR_FIELD_CAP = FIELDS_BASE + FIELDS_PER_FARMER * 2; // 10 — sublinear, not 2× the solo cap
const BARREN = 2;
const GRANARY = 6;
/** The fixture farm's wheat-slot ceiling (`stock` capacity 25 — keep in sync with fixtures/content.ts). */
export const FARM_WHEAT_CAP = 25;

// Component stores are module-level singletons — clear the WHOLE namespace between sims (AGENTS.md).
beforeEach(clearComponentStores);

/** A `width`×`height` CELL square of grass, upsampled to the half-cell navigation lattice. */
export function grassMap(width: number, height: number): TerrainMap {
  return halfCellMapFromCells({ width, height, typeIds: new Array(width * height).fill(GRASS) });
}

export function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: sim.tick,
    events: sim.events,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

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

export function granaryAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: GRANARY, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map() });
  return e;
}
