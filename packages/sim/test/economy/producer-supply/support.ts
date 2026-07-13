import { beforeEach } from 'vitest';
import { Building, JobAssignment, Position, Settler, Stockpile } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
  cellAnchorNode,
  fx,
  halfCellMapFromCells,
  ONE,
  type Simulation,
  type TerrainMap,
} from '../../../src/index.js';
import type { SystemContext } from '../../../src/systems/index.js';
import { clearComponentStores } from '../../fixtures/stores.js';

/**
 * The PRODUCER SELF-SERVICE + PORTER drives (`systems/agents/economy`): a worker
 * bound to a recipe workshop fetches the inputs it lacks from a store that holds them and hauls its own
 * finished output out, and a porter bound to a store collects loose ground piles into it. Fixture: good
 * 1 = wood, good 2 = plank, job 1 = woodcutter (harvest 24), job 2 = carpenter (no atomics — the mill's
 * operator), job 36 = carrier, building 1 = HQ (storage, wood+plank slots), building 2 = sawmill (recipe
 * 1 wood → 1 plank, employs the carpenter). Planner-level checks (one `aiSystem` pass) pin each decision
 * in isolation; an end-to-end run proves the loop closes.
 */

export const GRASS = 0;
export const WOOD = 1;
export const PLANK = 2;
export const WHEAT = 6;
export const WOODCUTTER = 1;
export const CARPENTER = 2;
export const CARRIER = 36;
export const HEADQUARTERS = 1;
export const SAWMILL = 2;
/** Fixture 7: 2 carpenter operator slots + a carrier slot, wood(cap 10) → plank(cap 20). */
export const TWIN_MILL = 8;
export const FARMER = 18; // the farm's field-worker job (plant atomic 34) — never hauls the farm's output out
/** Fixture 5: the grain farm — produces wheat via its field `farming` block: a FIELD producer whose
 *  store other producers may also draw inputs from, but never a storage SINK for its own good. */
export const FARM = 5;
export const GRANARY = 6; // a passive wheat store (the warehouse a farm's wheat is hauled OUT to)
export const VIKING = 1;
export const PICKUP_ATOMIC = 22;

// Component stores are module-level singletons — clear the WHOLE namespace between sims (AGENTS.md):
// the end-to-end runs here mint components (Resting, FarmTask, Crop, …) a hand-picked list misses,
// and their leftovers would leak onto reused entity ids in later tests in this file.
beforeEach(clearComponentStores);

/** A `width`×`height` CELL strip of grass, upsampled to the half-cell navigation lattice. */
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

export function settlerAt(sim: Simulation, x: number, y: number, jobType: number, boundTo?: Entity): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  if (boundTo !== undefined) sim.world.add(e, JobAssignment, { workplace: boundTo });
  return e;
}

/** A building store/workplace with an optional preset stockpile. */
export function buildingAt(
  sim: Simulation,
  buildingType: number,
  x: number,
  y: number,
  goods: Array<[number, number]> = [],
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map(goods) });
  return e;
}

/** A bare ground pile / flag: a positioned stockpile with NO building. */
export function pileAt(sim: Simulation, x: number, y: number, goods: Array<[number, number]> = []): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Stockpile, { amounts: new Map(goods) });
  return e;
}

/** The node id of visual tile (x, y) — walk goals address the doubled half-cell lattice. */
export function cell(sim: Simulation, x: number, y: number): number {
  const n = cellAnchorNode(x, y);
  return sim.terrain?.nodeAt(n.hx, n.hy) as number;
}
