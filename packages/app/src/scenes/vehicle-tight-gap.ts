import { buildingFootprintFor, footprintCellDx } from '@open-northland/data';
import {
  cellAnchorNode,
  components,
  type Entity,
  type HalfCellNode,
  hexDistanceBetween,
  playerCommand,
  type Simulation,
  SUCCESSFUL_IF,
  systems,
} from '@open-northland/sim';
import { grassTerrain, resolveVikingBuilding } from '../catalog/buildings.js';
import { JOB_CARRIER, JOB_SOLDIER } from '../catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import {
  GATHERERS,
  PALISADE_WALL_GFX_INDEX,
  placeBuiltSandboxBuildingAtNode,
  resourceSpecFor,
  spawnSettlerDirect,
  spawnVehicleDirect,
  VEHICLE_CATAPULT,
  VEHICLE_HANDCART,
  VEHICLE_OXCART,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * Where a catapult squeezes through and where only a cart does (docs/formats/VEHICLES.md "Movement"): a
 * palisade runs across the map, broken by lanes from west to east: two houses 1, 2, 3 and 4 nodes apart,
 * single tree lines with gaps of 1, 2 and 3 nodes, a sparse forest, and bare wall openings of 2 and 3
 * nodes. Four crewed catapults, two ox carts and a handcart are ordered across, some north to south and
 * some back. The catapult fits beside at most two tree and two house cells, never beside a wall. Under
 * the clean-room footprints a house blocks nothing, so the house lanes are plain wall openings headless.
 */

const MAP_W = 112;
const MAP_H = 30;
/** The half-cell row the palisade and every lane's obstacle line run along. */
const BARRIER_HY = 30;
/** Tile rows the drives start and end on, eight tiles either side of the barrier. */
const NORTH_ROW = 7;
const SOUTH_ROW = 23;
/** Wall nodes between two lanes, so a vehicle that fails its own gap is not steered into the next one. */
const LANE_SPACING = 6;
const FIRST_LANE_HX = 8;
const HOUSE = 'home_level_00';
/** A tree line's run, gap included. */
const TREE_LINE_NODES = 13;
/** The sparse forest: its run on the barrier row and its rows either side. */
const FOREST_NODES = 15;
const FOREST_HALF_ROWS = 4;
/** One tree every this many nodes on every other forest row, each such row shifted by one node. */
const FOREST_SPACING = 3;
const FOREST_ROW_STEP = 2;
/** How near its target a vehicle counts as arrived: a snapped or shoved goal lands a few nodes off. */
const ARRIVAL_SLACK = 4;
/** The commanders board first; the orders wait for them. */
const DRIVE_ORDER_TICK = 6;
/** Claims positions no session transport hands out for that tick. */
const ORDER_SEQUENCE = 1_000_000;
const RUN_TICKS = 1_600;
/** The commander stands a tile behind its vehicle, off the disc its first leg enters. */
const COMMANDER_ROW_OFFSET = 1;

const { Vehicle } = components;

export type TightGapLaneKind = 'houses' | 'trees' | 'forest' | 'wallOpening';

interface LaneSpec {
  readonly kind: TightGapLaneKind;
  /** Open nodes between the obstacles; unused by the forest. */
  readonly gap: number;
}

const LANE_SPECS: readonly LaneSpec[] = [
  { kind: 'houses', gap: 1 },
  { kind: 'houses', gap: 2 },
  { kind: 'houses', gap: 3 },
  { kind: 'houses', gap: 4 },
  { kind: 'trees', gap: 1 },
  { kind: 'trees', gap: 2 },
  { kind: 'trees', gap: 3 },
  { kind: 'forest', gap: 0 },
  { kind: 'wallOpening', gap: 2 },
  { kind: 'wallOpening', gap: 3 },
];

/** A laid-out lane: the barrier-row span its obstacles own (the palisade fills the rest) and the
 *  column its drives aim through. */
export interface TightGapLane extends LaneSpec {
  readonly from: number;
  readonly to: number;
  readonly centre: number;
  /** The two house anchors of a house lane. */
  readonly houses?: readonly [number, number];
}

/** The walk-blocked nodes of a house anchored at `(hx, BARRIER_HY)`, or its anchor alone under a
 *  footprint that blocks nothing. */
function houseBody(sim: Simulation, hx: number): HalfCellNode[] {
  const typeId = resolveVikingBuilding(HOUSE).typeId;
  const def = sim.content.buildings.find((b) => b.typeId === typeId);
  const cells = def === undefined ? [] : (buildingFootprintFor(def, PRIMARY_TRIBE)?.blocked ?? []);
  if (cells.length === 0) return [{ hx, hy: BARRIER_HY }];
  return cells.map((c) => ({ hx: hx + footprintCellDx(BARRIER_HY, c), hy: BARRIER_HY + c.dy }));
}

/** The open nodes on the shortest hexagon line between two bodies. */
function bodyGap(a: readonly HalfCellNode[], b: readonly HalfCellNode[]): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const p of a)
    for (const q of b) nearest = Math.min(nearest, hexDistanceBetween(p.hx, p.hy, q.hx, q.hy));
  return nearest - 1;
}

function barrierSpan(body: readonly HalfCellNode[]): { readonly min: number; readonly max: number } {
  const xs = body.filter((n) => n.hy === BARRIER_HY).map((n) => n.hx);
  return { min: Math.min(...xs), max: Math.max(...xs) };
}

function layHouses(sim: Simulation, spec: LaneSpec, start: number): TightGapLane {
  const westBody = houseBody(sim, 0);
  const westSpan = barrierSpan(westBody);
  const west = start - westSpan.min;
  const westAt = houseBody(sim, west);
  let east = west + 1;
  while (bodyGap(westAt, houseBody(sim, east)) < spec.gap) east++;
  const eastSpan = barrierSpan(houseBody(sim, east));
  const westEdge = barrierSpan(westAt).max;
  return {
    ...spec,
    from: start,
    to: eastSpan.max,
    centre: Math.floor((westEdge + eastSpan.min) / 2),
    houses: [west, east],
  };
}

function layLane(sim: Simulation, spec: LaneSpec, start: number): TightGapLane {
  switch (spec.kind) {
    case 'houses':
      return layHouses(sim, spec, start);
    case 'trees': {
      const to = start + TREE_LINE_NODES - 1;
      return { ...spec, from: start, to, centre: start + Math.floor((TREE_LINE_NODES - spec.gap) / 2) };
    }
    case 'forest': {
      const to = start + FOREST_NODES - 1;
      return { ...spec, from: start, to, centre: start + Math.floor(FOREST_NODES / 2) };
    }
    case 'wallOpening':
      return { ...spec, from: start, to: start + spec.gap - 1, centre: start };
  }
}

/** The lanes west to east, laid over the scene content's own house footprint. */
export function tightGapLanes(sim: Simulation): TightGapLane[] {
  const lanes: TightGapLane[] = [];
  let start = FIRST_LANE_HX;
  for (const spec of LANE_SPECS) {
    const lane = layLane(sim, spec, start);
    lanes.push(lane);
    start = lane.to + 1 + LANE_SPACING;
  }
  return lanes;
}

/** The nodes of a tree lane's line or a forest's pattern. */
function laneTrees(lane: TightGapLane): HalfCellNode[] {
  const trees: HalfCellNode[] = [];
  if (lane.kind === 'trees') {
    for (let hx = lane.from; hx <= lane.to; hx++) {
      if (hx < lane.centre || hx >= lane.centre + lane.gap) trees.push({ hx, hy: BARRIER_HY });
    }
  } else if (lane.kind === 'forest') {
    for (let hy = BARRIER_HY - FOREST_HALF_ROWS; hy <= BARRIER_HY + FOREST_HALF_ROWS; hy += FOREST_ROW_STEP) {
      const shift = ((hy - BARRIER_HY + FOREST_HALF_ROWS) / FOREST_ROW_STEP) % FOREST_SPACING;
      for (let hx = lane.from + shift; hx <= lane.to; hx += FOREST_SPACING) trees.push({ hx, hy });
    }
  }
  return trees;
}

function placeTree(sim: Simulation, at: HalfCellNode): void {
  const wood = GATHERERS.find((g) => g.id === 'wood');
  if (wood === undefined) throw new Error('vehicle-tight-gap: no wood gatherer spec');
  if (systems.createResourceNode(sim.world, sim.content, resourceSpecFor(wood, at.hx, at.hy)) === null) {
    throw new Error('vehicle-tight-gap: no tree footprint');
  }
}

function placeWall(sim: Simulation, hx: number): void {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('vehicle-tight-gap requires terrain');
  const type = systems.palisadeType(terrain, PALISADE_WALL_GFX_INDEX);
  if (type === undefined) throw new Error('vehicle-tight-gap: no palisade record');
  const wall = systems.createPalisade(sim.world, type, {
    x: hx,
    y: BARRIER_HY,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
    underConstruction: false,
  });
  if (wall === null) throw new Error(`vehicle-tight-gap: no wall at ${hx}`);
}

/** A crossing: a vehicle in lane `lane`, `offset` nodes off its centre, driven from one side to the other. */
interface Drive {
  readonly type: number;
  readonly lane: number;
  readonly offset: number;
  readonly southward: boolean;
}

export const TIGHT_GAP_DRIVES = {
  /** Two houses one node apart: too tight for the catapult. */
  catapultHouseGap1: { type: VEHICLE_CATAPULT, lane: 0, offset: -2, southward: true },
  oxcartHouseGap1: { type: VEHICLE_OXCART, lane: 0, offset: 2, southward: false },
  catapultHouseGap2: { type: VEHICLE_CATAPULT, lane: 1, offset: 0, southward: true },
  handcartHouseGap4: { type: VEHICLE_HANDCART, lane: 3, offset: 0, southward: false },
  catapultTreeGap1: { type: VEHICLE_CATAPULT, lane: 4, offset: 0, southward: false },
  catapultForest: { type: VEHICLE_CATAPULT, lane: 7, offset: 0, southward: true },
  oxcartWallOpening2: { type: VEHICLE_OXCART, lane: 8, offset: 0, southward: false },
} as const satisfies Record<string, Drive>;

/** The tile a drive starts on (`from`) or is ordered to (`to`). */
function driveTile(lane: TightGapLane, drive: Drive, end: 'from' | 'to'): { x: number; y: number } {
  const north = (end === 'from') === drive.southward;
  return { x: Math.floor((lane.centre + drive.offset) / 2), y: north ? NORTH_ROW : SOUTH_ROW };
}

function laneOf(lanes: readonly TightGapLane[], drive: Drive): TightGapLane {
  const lane = lanes[drive.lane];
  if (lane === undefined) throw new Error(`vehicle-tight-gap: no lane ${drive.lane}`);
  return lane;
}

function build(sim: Simulation): void {
  const lanes = tightGapLanes(sim);
  const owned = new Set<number>();
  for (const lane of lanes) {
    for (let hx = lane.from; hx <= lane.to; hx++) owned.add(hx);
    for (const hx of lane.houses ?? []) placeBuiltSandboxBuildingAtNode(sim, HOUSE, hx, BARRIER_HY);
    for (const tree of laneTrees(lane)) placeTree(sim, tree);
  }
  for (let hx = 0; hx < MAP_W * 2; hx++) if (!owned.has(hx)) placeWall(sim, hx);

  Object.values(TIGHT_GAP_DRIVES).forEach((drive: Drive, index) => {
    const lane = laneOf(lanes, drive);
    const from = driveTile(lane, drive, 'from');
    const vehicle = spawnVehicleDirect(sim, drive.type, from.x, from.y);
    const job = drive.type === VEHICLE_CATAPULT ? JOB_SOLDIER : JOB_CARRIER;
    const behind = drive.southward ? -COMMANDER_ROW_OFFSET : COMMANDER_ROW_OFFSET;
    const commander = spawnSettlerDirect(sim, job, from.x, from.y + behind);
    sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachToVehicle', entity: commander, vehicle }));
    const toTile = driveTile(lane, drive, 'to');
    const to = cellAnchorNode(toTile.x, toTile.y);
    sim.enqueueAt(
      playerCommand(HUMAN_PLAYER, { kind: 'moveVehicle', vehicle, x: to.hx, y: to.hy }),
      DRIVE_ORDER_TICK,
      ORDER_SEQUENCE + index,
    );
  });
}

/** The local player's vehicle of the drive's type standing within reach of the drive's target. */
function arrivedVehicle(sim: Simulation, drive: Drive): Entity | undefined {
  const tile = driveTile(laneOf(tightGapLanes(sim), drive), drive, 'to');
  const to = cellAnchorNode(tile.x, tile.y);
  return sim.vehiclesOf(HUMAN_PLAYER).find((v) => {
    if (v.vehicleType !== drive.type || v.at === null || v.at === undefined) return false;
    return hexDistanceBetween(v.at.hx, v.at.hy, to.hx, to.hy) <= ARRIVAL_SLACK;
  })?.entity;
}

function arrived(drive: Drive): (sim: Simulation) => boolean {
  return (sim) => arrivedVehicle(sim, drive) !== undefined;
}

/** A camera over the house lanes, where the one-node gap sends a catapult round. */
const CAMERA_AT = { hx: 40, hy: BARRIER_HY } as const;

export const vehicleTightGapScene: SceneDefinition = {
  id: 'vehicle-tight-gap',
  seed: 29,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  missions: {
    missions: [
      {
        active: true,
        visible: false,
        successfullIf: SUCCESSFUL_IF.all,
        goals: [],
        results: [{ opcode: 'SetCameraPosition', point: CAMERA_AT }],
      },
    ],
  },
  runTicks: RUN_TICKS,
  initialZoom: 1,
  checks: [
    {
      label: 'the ox cart threads the two houses one node apart',
      predicate: arrived(TIGHT_GAP_DRIVES.oxcartHouseGap1),
    },
    {
      label: 'a catapult crosses between the two houses two nodes apart',
      predicate: arrived(TIGHT_GAP_DRIVES.catapultHouseGap2),
    },
    {
      label: 'the handcart crosses between the houses four nodes apart',
      predicate: arrived(TIGHT_GAP_DRIVES.handcartHouseGap4),
    },
    {
      label: 'a catapult squeezes through the one-node gap in a tree line',
      predicate: arrived(TIGHT_GAP_DRIVES.catapultTreeGap1),
    },
    {
      label: 'a catapult weaves through the sparse forest',
      predicate: arrived(TIGHT_GAP_DRIVES.catapultForest),
    },
    {
      label: 'the ox cart passes the two-node wall opening',
      predicate: arrived(TIGHT_GAP_DRIVES.oxcartWallOpening2),
    },
    {
      label: 'every vehicle still stands',
      predicate: (sim) => [...sim.world.query(Vehicle)].length === Object.keys(TIGHT_GAP_DRIVES).length,
    },
  ],
};
