import type { Entity, Simulation } from '@open-northland/sim';
import { components } from '@open-northland/sim';
import { grassTerrain, placedBuildingTypes, resolveVikingBuilding } from '../catalog/buildings.js';
import { WOOD_YIELD_PER_NODE } from '../catalog/felling.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  GATHERERS,
  type GathererSpec,
  GOOD_GOLD,
  GOOD_IRON,
  GOOD_MUD,
  GOOD_MUSHROOM,
  GOOD_STONE,
  GOOD_WOOD,
  JOB_CARRIER,
  placeFlag,
  placeResourceNode,
  placeSandboxBerryBush,
  placeSandboxBuilding,
  spawnBoundGatherer,
  staffableCrewFor,
  staffBuildingFully,
} from '../game/sandbox/index.js';
import { createSceneSim } from './runtime.js';
import { yardGood } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

const { Building, JobAssignment, Owner, Resource, Settler, Stockpile } = components;

/**
 * The main sandbox scene: a small, fully staffed viking settlement over a resource-gathering base — the
 * production inspection world. The village (storage + homes + one workshop per trade) sits in the north
 * with every building staffed to its worker capacity and the warehouse pre-filled to its limits; the south
 * is a spread of gathering camps (a forest, a quarry, a clay pit, iron and gold outcrops, a mushroom grove),
 * each with its own delivery flag and bound gatherers. The scene defines only placement — content, rules,
 * and controls stay in `game/sandbox/`, `entries/scene.ts`, and `entries/map.ts`.
 */

const MAP_W = 96;
const MAP_H = 96;
const INITIAL_ZOOM = 0.5;
/** Enough for the slowest first delivery — a mined unit (clay: 6 strikes × 23-tick digs + rests) dug,
 *  carried to its flag, and banked — with headroom for the walk from every camp's spawn. */
const RUN_TICKS = 2400;

/**
 * The village: every building placed, hand-authored so the settlement reads as one — storage row on top,
 * homes beside it, two workshop streets below, and the two farms on the western edge with open grass to
 * sow/graze. Positions keep every real extracted footprint comfortably clear of its neighbours (7-tile
 * street pitch; homes are small, so 5).
 */
const VILLAGE: ReadonlyArray<{ readonly id: string; readonly x: number; readonly y: number }> = [
  // Storage row + homes.
  { id: 'home_level_00', x: 24, y: 8 },
  { id: 'home_level_00', x: 29, y: 8 },
  { id: 'home_level_00', x: 34, y: 8 },
  { id: 'headquarters', x: 42, y: 8 },
  { id: 'stock_00', x: 52, y: 8 },
  // Craft street.
  { id: 'work_joinery_00', x: 18, y: 16 },
  { id: 'work_mason_hut_00', x: 25, y: 16 },
  { id: 'work_smithy_00', x: 32, y: 16 },
  { id: 'work_armory_00', x: 39, y: 16 },
  { id: 'work_coin_mint', x: 46, y: 16 },
  { id: 'work_pottery_00', x: 53, y: 16 },
  { id: 'work_sewery_00', x: 60, y: 16 },
  { id: 'work_druid_00', x: 67, y: 16 },
  // Food street.
  { id: 'work_hive_00', x: 18, y: 24 },
  { id: 'work_mill_00', x: 25, y: 24 },
  { id: 'work_bakery_00', x: 32, y: 24 },
  { id: 'work_well_00', x: 39, y: 24 },
  { id: 'work_brewery', x: 46, y: 24 },
  { id: 'work_herb_hut', x: 53, y: 24 },
  { id: 'work_animal_farm', x: 64, y: 24 },
  // Farms on the open western edge (field-farming sows the grass around the building).
  { id: 'work_farm_00', x: 8, y: 32 },
];

/** The pre-stocked store — the warehouse the scene seeds full (`fillStock`) so production has inputs
 *  from tick 1. */
const WAREHOUSE_ID = 'stock_00';

/**
 * One gathering camp: a cluster of `nodes` around `center` (hand-authored offsets so each camp reads
 * organic, not gridded), a delivery flag on its village side, and `gatherers` collectors bound to that
 * flag and pinned to the camp's good.
 */
interface GatherCamp {
  readonly good: number;
  readonly center: { readonly x: number; readonly y: number };
  readonly nodes: ReadonlyArray<{ readonly dx: number; readonly dy: number }>;
  readonly flag: { readonly x: number; readonly y: number };
  readonly gatherers: number;
}

/** An organic ~14-node blob for the forest camp (also reused, truncated, by the smaller camps). */
const BLOB: ReadonlyArray<{ readonly dx: number; readonly dy: number }> = [
  { dx: 0, dy: 0 },
  { dx: 2, dy: -1 },
  { dx: -2, dy: 1 },
  { dx: 1, dy: 2 },
  { dx: -1, dy: -2 },
  { dx: 3, dy: 1 },
  { dx: -3, dy: -1 },
  { dx: 0, dy: 3 },
  { dx: 2, dy: -3 },
  { dx: -2, dy: 3 },
  { dx: 4, dy: -1 },
  { dx: -4, dy: 0 },
  { dx: 1, dy: -4 },
  { dx: -1, dy: 4 },
];

/**
 * The southern resource base: one camp per gatherable good, each a stretch of map apart (camp centres
 * ≥ ~20 tiles) so no flag radius overlaps a neighbour and the base reads as distinct sites — a small
 * forest, a quarry, a clay pit, iron and gold outcrops, and a mushroom grove.
 */
const CAMPS: readonly GatherCamp[] = [
  { good: GOOD_WOOD, center: { x: 14, y: 60 }, nodes: BLOB, flag: { x: 20, y: 60 }, gatherers: 3 },
  {
    good: GOOD_STONE,
    center: { x: 36, y: 68 },
    nodes: BLOB.slice(0, 5),
    flag: { x: 40, y: 66 },
    gatherers: 2,
  },
  { good: GOOD_MUD, center: { x: 54, y: 58 }, nodes: BLOB.slice(0, 4), flag: { x: 58, y: 58 }, gatherers: 2 },
  {
    good: GOOD_IRON,
    center: { x: 70, y: 66 },
    nodes: BLOB.slice(0, 4),
    flag: { x: 74, y: 64 },
    gatherers: 2,
  },
  {
    good: GOOD_GOLD,
    center: { x: 84, y: 56 },
    nodes: BLOB.slice(0, 3),
    flag: { x: 86, y: 59 },
    gatherers: 1,
  },
  {
    good: GOOD_MUSHROOM,
    center: { x: 26, y: 80 },
    nodes: BLOB.slice(0, 8),
    flag: { x: 30, y: 80 },
    gatherers: 2,
  },
];

/** A wild berry patch beside the mushroom grove — forage decor (needs are off by default), drawn with the
 *  real fruited-bush art (the same `[GfxLandscape]` variant the berries scene pins). */
const BERRY_PATCH = { x: 56, y: 80 } as const;
const BERRY_BUSHES = 5;
const BUSH_FRUITS_GFX = 806;

const GATHERER_BY_GOOD: ReadonlyMap<number, GathererSpec> = new Map(GATHERERS.map((g) => [g.good, g]));

function buildVillage(sim: Simulation): void {
  for (const b of VILLAGE) {
    placeSandboxBuilding(sim, b.id, b.x, b.y, HUMAN_PLAYER, {
      fillStock: b.id === WAREHOUSE_ID,
    });
    staffBuildingFully(sim, resolveVikingBuilding(b.id).typeId, b.x, b.y);
  }
}

function buildResourceBase(sim: Simulation): void {
  for (const camp of CAMPS) {
    const g = GATHERER_BY_GOOD.get(camp.good);
    if (g === undefined) throw new Error(`sandbox camp: no gatherer trade for good ${camp.good}`);
    for (const { dx, dy } of camp.nodes) {
      placeResourceNode(sim, g, camp.center.x + dx, camp.center.y + dy);
    }
    // One flag per gatherer (the flag-click selection inverse is 1:1 — a flag resolves to its one
    // gatherer), planted in a short row on the camp's village side; each gatherer works only this camp
    // (radius + good filter) and banks its harvest at its own flag (see spawnBoundGatherer).
    for (let i = 0; i < camp.gatherers; i++) {
      const flag = placeFlag(sim, camp.flag.x + i, camp.flag.y);
      spawnBoundGatherer(sim, g.job, camp.flag.x + i, camp.flag.y + 1, flag, { goodType: camp.good });
    }
  }
  for (let i = 0; i < BERRY_BUSHES; i++) {
    placeSandboxBerryBush(sim, BERRY_PATCH.x + i * 2, BERRY_PATCH.y + (i % 2), BUSH_FRUITS_GFX);
  }
}

function build(sim: Simulation): void {
  buildVillage(sim);
  buildResourceBase(sim);
}

/** The distinct building typeIds the village places (homes repeat one type). */
const VILLAGE_TYPE_IDS: ReadonlySet<number> = new Set(VILLAGE.map((b) => resolveVikingBuilding(b.id).typeId));

/** Bound settlers per (building, jobType) — the check-side mirror of the JobSystem's staffing tally. */
function boundCrewCount(sim: Simulation, building: Entity, jobType: number): number {
  let n = 0;
  for (const e of sim.world.query(Settler, JobAssignment)) {
    if (sim.world.get(e, JobAssignment).workplace !== building) continue;
    if (sim.world.get(e, Settler).jobType === jobType) n++;
  }
  return n;
}

/** Every placed building's staffable production (non-carrier) slots hold exactly their crew. Carriers are
 *  covered by the settlement-wide total instead (a loose carrier reports in to the first open post in
 *  canonical order, so an individual carrier may post to a neighbour). */
function producingCrewsComplete(sim: Simulation): boolean {
  for (const e of sim.world.query(Building)) {
    const type = sim.world.get(e, Building).buildingType;
    for (const slot of staffableCrewFor(sim, type)) {
      if (slot.jobType === JOB_CARRIER) continue;
      if (boundCrewCount(sim, e, slot.jobType) !== slot.count) return false;
    }
  }
  return true;
}

/** Total staffable slots across the placed settlement vs total bound settlers — the carriers' half of the
 *  staffing proof (see {@link producingCrewsComplete}). */
function settlementFullyStaffed(sim: Simulation): boolean {
  let expected = 0;
  for (const e of sim.world.query(Building)) {
    const type = sim.world.get(e, Building).buildingType;
    for (const slot of staffableCrewFor(sim, type)) expected += slot.count;
  }
  let bound = 0;
  for (const _ of sim.world.query(JobAssignment)) bound++;
  return expected > 0 && bound === expected;
}

/** The units a camp's authored nodes start with, from the gatherer catalog (per-mode node yield). */
function initialUnits(camp: GatherCamp): number {
  const g = GATHERER_BY_GOOD.get(camp.good);
  if (g === undefined) return 0;
  const perNode = g.mode === 'fell' ? WOOD_YIELD_PER_NODE : g.mode === 'mine' ? (g.depositUnits ?? 0) : 1;
  return camp.nodes.length * perNode;
}

/** The units still sitting in `good`'s live resource nodes (a fully consumed node is gone entirely). */
function remainingUnits(sim: Simulation, good: number): number {
  let total = 0;
  for (const e of sim.world.query(Resource)) {
    const r = sim.world.get(e, Resource);
    if (r.goodType === good) total += r.remaining;
  }
  return total;
}

/** The one placed warehouse holds every stock slot at its capacity. */
function warehouseFull(sim: Simulation): boolean {
  const typeId = resolveVikingBuilding(WAREHOUSE_ID).typeId;
  const slots = sim.content.buildings.find((b) => b.typeId === typeId)?.stock ?? [];
  if (slots.length === 0) return false;
  for (const e of sim.world.query(Building)) {
    if (sim.world.get(e, Building).buildingType !== typeId) continue;
    const amounts = sim.world.get(e, Stockpile).amounts;
    return slots.every((s) => (amounts.get(s.goodType) ?? 0) === s.capacity);
  }
  return false;
}

export const sandboxScene: SceneDefinition = {
  id: 'sandbox',
  seed: 41,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'the village settlement is fully placed (every authored building type present)',
      predicate: (sim) => {
        const placed = placedBuildingTypes(sim);
        return [...VILLAGE_TYPE_IDS].every((t) => placed.has(t)) && placed.size === VILLAGE_TYPE_IDS.size;
      },
    },
    {
      label: 'the warehouse is seeded full at placement (checked on a fresh 2-tick run of the same build)',
      predicate: () => {
        // The end-of-run world is the wrong witness (production legitimately consumes the stores), so the
        // full-at-start claim is proven on a fresh sim of the same scene advanced just past its placement
        // commands. Deterministic and sandbox-content only, like the whole headless twin.
        const fresh = createSceneSim(sandboxScene);
        fresh.run(2);
        return warehouseFull(fresh);
      },
    },
    {
      label: 'every staffable worker slot in the settlement is filled',
      predicate: settlementFullyStaffed,
    },
    {
      label: 'every producing workshop holds its full non-carrier crew',
      predicate: producingCrewsComplete,
    },
    {
      label: 'every gathering camp is being worked (its nodes are partly consumed)',
      // Node depletion is the harvest witness — the banked heaps are the wrong one, because the village
      // carriers legitimately haul them off to the stores as part of the living economy.
      predicate: (sim) => CAMPS.every((camp) => remainingUnits(sim, camp.good) < initialUnits(camp)),
    },
    {
      label: 'some harvest reached the ground heaps or moved on into the stores',
      predicate: (sim) => CAMPS.some((camp) => yardGood(sim, camp.good) > 0),
    },
    {
      label: 'every settler belongs to the blue human player (no hostiles on the map)',
      predicate: (sim) => {
        for (const e of sim.world.query(Settler, Owner)) {
          if (sim.world.get(e, Owner).player !== HUMAN_PLAYER) return false;
        }
        return true;
      },
    },
  ],
};
