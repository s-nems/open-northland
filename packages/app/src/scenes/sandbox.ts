import type { Entity, Simulation } from '@open-northland/sim';
import { components } from '@open-northland/sim';
import {
  grassTerrain,
  placedBuildingTypes,
  resolveVikingBuilding,
  VIKING_BUILDINGS,
} from '../catalog/buildings.js';
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
 * The main sandbox scene: a compact, fully staffed viking settlement over a resource-gathering base — the
 * production inspection world. The village carries the FULL viking catalog (all 41 building types, every
 * level of every chain) packed to the placement rule's limits, every building staffed to its worker
 * capacity, and all three warehouse tiers pre-filled to their limits; gathering camps hug the village
 * (a forest, a quarry, a clay pit, iron and gold outcrops, a mushroom grove), each with per-gatherer
 * delivery flags and good-pinned bindings. The scene defines only placement — content, rules, and
 * controls stay in `game/sandbox/`, `entries/scene.ts`, and `entries/map.ts`.
 */

const MAP_W = 96;
const MAP_H = 96;
const INITIAL_ZOOM = 0.5;
/** Enough for the slowest first delivery — a mined unit (clay: 6 strikes × 23-tick digs + rests) dug,
 *  carried to its flag, and banked — with headroom for the walk from every camp's spawn. */
const RUN_TICKS = 2400;

/**
 * The village: the FULL viking catalog — all 41 building types, every level of every chain — packed as
 * tight as the placement rule allows. The coordinates are the output of a layout pass over the real
 * extracted footprints (each building's blocked cells stay outside every neighbour's reserved zone,
 * mutually, with one node of slack — the `canPlaceBuilding` walls-outside-zones rule on bounding boxes),
 * so the authored placements would also be legal interactively. Streets group by trade: homes/civic on
 * top, storage + towers, two craft streets, the food street, and the space-hungry farms/barracks at the
 * bottom edge with open grass to sow and graze.
 */
const VILLAGE: ReadonlyArray<{ readonly id: string; readonly x: number; readonly y: number }> = [
  // Homes (every level) + civic row.
  { id: 'home_level_00', x: 8, y: 7 },
  { id: 'home_level_01', x: 13, y: 7 },
  { id: 'home_level_02', x: 18, y: 7 },
  { id: 'home_level_03', x: 23, y: 7 },
  { id: 'home_level_04', x: 28, y: 7 },
  { id: 'school', x: 33, y: 7 },
  { id: 'work_temple', x: 39, y: 7 },
  // Storage row + watchtowers.
  { id: 'headquarters', x: 8, y: 15 },
  { id: 'stock_00', x: 14, y: 15 },
  { id: 'stock_01', x: 18, y: 15 },
  { id: 'stock_02', x: 22, y: 15 },
  { id: 'tower_00', x: 26, y: 15 },
  { id: 'tower_01', x: 29, y: 15 },
  // Wood & stone craft street.
  { id: 'work_joinery_00', x: 8, y: 23 },
  { id: 'work_joinery_01', x: 12, y: 23 },
  { id: 'work_joinery_02', x: 16, y: 23 },
  { id: 'work_joinery_03', x: 20, y: 23 },
  { id: 'work_mason_hut_00', x: 25, y: 23 },
  { id: 'work_mason_hut_01', x: 31, y: 23 },
  { id: 'work_smithy_00', x: 38, y: 23 },
  { id: 'work_smithy_01', x: 43, y: 23 },
  // Metal & wares craft street.
  { id: 'work_armory_00', x: 8, y: 31 },
  { id: 'work_armory_01', x: 13, y: 31 },
  { id: 'work_pottery_00', x: 17, y: 31 },
  { id: 'work_pottery_01', x: 22, y: 31 },
  { id: 'work_pottery_02', x: 27, y: 31 },
  { id: 'work_sewery_00', x: 31, y: 31 },
  { id: 'work_sewery_01', x: 36, y: 31 },
  { id: 'work_coin_mint', x: 41, y: 31 },
  // Food street.
  { id: 'work_well_00', x: 8, y: 39 },
  { id: 'work_hive_00', x: 10, y: 39 },
  { id: 'work_mill_00', x: 13, y: 39 },
  { id: 'work_bakery_00', x: 18, y: 39 },
  { id: 'work_bakery_01', x: 23, y: 39 },
  { id: 'work_brewery', x: 28, y: 39 },
  { id: 'work_herb_hut', x: 33, y: 39 },
  { id: 'work_druid_00', x: 37, y: 39 },
  { id: 'work_druid_01', x: 42, y: 39 },
  // The space-hungry bottom edge: farms with sow/graze grass, and the deep barracks footprint.
  { id: 'work_farm_00', x: 8, y: 49 },
  { id: 'work_animal_farm', x: 13, y: 49 },
  { id: 'barracks', x: 20, y: 49 },
];

/** The pre-stocked stores — every warehouse tier the scene seeds full (`fillStock`) so production has
 *  inputs from tick 1. */
const WAREHOUSE_IDS: ReadonlySet<string> = new Set(['stock_00', 'stock_01', 'stock_02']);

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

/** An organic ~20-node blob for the forest camp (also reused, truncated, by the smaller camps). */
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
  { dx: 5, dy: 2 },
  { dx: -5, dy: 3 },
  { dx: 3, dy: 4 },
  { dx: -3, dy: -4 },
  { dx: 6, dy: 0 },
  { dx: 0, dy: -6 },
];

/**
 * The resource base hugging the village: the forest, quarry and clay pit just south of the bottom edge,
 * the iron/gold outcrops and the mushroom grove on the open eastern flank beside their consumer streets.
 * Camps sit close (short haul walks); each gatherer's good filter keeps overlapping flag radii from
 * poaching a neighbour camp's nodes.
 */
const CAMPS: readonly GatherCamp[] = [
  { good: GOOD_WOOD, center: { x: 10, y: 64 }, nodes: BLOB, flag: { x: 16, y: 62 }, gatherers: 4 },
  {
    good: GOOD_STONE,
    center: { x: 30, y: 60 },
    nodes: BLOB.slice(0, 8),
    flag: { x: 34, y: 58 },
    gatherers: 3,
  },
  { good: GOOD_MUD, center: { x: 44, y: 58 }, nodes: BLOB.slice(0, 6), flag: { x: 48, y: 55 }, gatherers: 2 },
  {
    good: GOOD_IRON,
    center: { x: 58, y: 24 },
    nodes: BLOB.slice(0, 6),
    flag: { x: 53, y: 23 },
    gatherers: 3,
  },
  {
    good: GOOD_GOLD,
    center: { x: 58, y: 36 },
    nodes: BLOB.slice(0, 5),
    flag: { x: 53, y: 35 },
    gatherers: 2,
  },
  {
    good: GOOD_MUSHROOM,
    center: { x: 54, y: 46 },
    nodes: BLOB.slice(0, 12),
    flag: { x: 50, y: 46 },
    gatherers: 2,
  },
];

/** A wild berry patch beside the mushroom grove — forage decor (needs are off by default), drawn with the
 *  real fruited-bush art (the same `[GfxLandscape]` variant the berries scene pins). */
const BERRY_PATCH = { x: 60, y: 52 } as const;
const BERRY_BUSHES = 6;
const BUSH_FRUITS_GFX = 806;

const GATHERER_BY_GOOD: ReadonlyMap<number, GathererSpec> = new Map(GATHERERS.map((g) => [g.good, g]));

/**
 * How many times over the catalog size each mined deposit is filled here. At the catalog sizes a
 * triple-staffed camp drains its outcrop in ~10 minutes of 1× play and the miners then stand idle
 * (user-observed as "the iron/gold miners stopped") — the inspection world wants camps that outlast
 * any session, while normal play keeps the catalog's finite deposits.
 */
const MINE_DEPOSIT_SCALE = 100;

function buildVillage(sim: Simulation): void {
  for (const b of VILLAGE) {
    placeSandboxBuilding(sim, b.id, b.x, b.y, HUMAN_PLAYER, {
      fillStock: WAREHOUSE_IDS.has(b.id),
    });
    staffBuildingFully(sim, resolveVikingBuilding(b.id).typeId, b.x, b.y);
  }
}

function buildResourceBase(sim: Simulation): void {
  for (const camp of CAMPS) {
    const g = GATHERER_BY_GOOD.get(camp.good);
    if (g === undefined) throw new Error(`sandbox camp: no gatherer trade for good ${camp.good}`);
    for (const { dx, dy } of camp.nodes) {
      placeResourceNode(sim, g, camp.center.x + dx, camp.center.y + dy, {
        unitsScale: g.mode === 'mine' ? MINE_DEPOSIT_SCALE : 1,
      });
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
  const perNode =
    g.mode === 'fell'
      ? WOOD_YIELD_PER_NODE
      : g.mode === 'mine'
        ? (g.depositUnits ?? 0) * MINE_DEPOSIT_SCALE
        : 1;
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

/** Every placed warehouse tier holds every one of its stock slots at its capacity. */
function warehousesFull(sim: Simulation): boolean {
  let seen = 0;
  for (const id of WAREHOUSE_IDS) {
    const typeId = resolveVikingBuilding(id).typeId;
    const slots = sim.content.buildings.find((b) => b.typeId === typeId)?.stock ?? [];
    if (slots.length === 0) return false;
    for (const e of sim.world.query(Building)) {
      if (sim.world.get(e, Building).buildingType !== typeId) continue;
      seen++;
      const amounts = sim.world.get(e, Stockpile).amounts;
      if (!slots.every((s) => (amounts.get(s.goodType) ?? 0) === s.capacity)) return false;
    }
  }
  return seen === WAREHOUSE_IDS.size;
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
      label: 'the full viking building catalog is placed (every type, every level)',
      predicate: (sim) => {
        const placed = placedBuildingTypes(sim);
        return (
          [...VILLAGE_TYPE_IDS].every((t) => placed.has(t)) &&
          placed.size === VILLAGE_TYPE_IDS.size &&
          placed.size === VIKING_BUILDINGS.length
        );
      },
    },
    {
      label: 'every warehouse tier is seeded full at placement (fresh 2-tick run of the same build)',
      predicate: () => {
        // The end-of-run world is the wrong witness (production legitimately consumes the stores), so the
        // full-at-start claim is proven on a fresh sim of the same scene advanced just past its placement
        // commands. Deterministic and sandbox-content only, like the whole headless twin.
        const fresh = createSceneSim(sandboxScene);
        fresh.run(2);
        return warehousesFull(fresh);
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
