import type { ContentSet } from '@open-northland/data';
import {
  fightsPlayer,
  Health,
  isValidPlayer,
  Owner,
  Position,
  Settler,
  Vehicle,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import {
  type HalfCellNode,
  hexDistanceBetween,
  nodeHxOfPosition,
  nodeHyOfPosition,
} from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { type PlacementProbe, placementProbe, siteReachFor } from '../footprint/index.js';
import { peaceGroundFor } from '../match/peace.js';
import { isFighterJob } from '../readviews/index.js';
import { type FogState, playerSeesEntity } from '../vision/index.js';
import { SIGHT_RADIUS_NODES } from './targeting.js';
import { standsAtPost } from './tower-post.js';
import { VEHICLE_SCAN_RADIUS_POINTS } from './vehicle-targets.js';
import { vehicleWeapon } from './weapons.js';

/**
 * How near (Manhattan half-cell nodes) a hostile fighter or unarmed vehicle refuses a site: a fighter who
 * can see the ground strikes the foundation the tick it stands. Deliberate divergence: the original places
 * freely under an enemy army (observation). Approximation on three counts: measured at the anchor rather
 * than the walls, with the plain sight radius rather than a bow's reach, and for a holding guard as for an
 * attacker.
 */
export const CONTESTED_GROUND_RADIUS_NODES = SIGHT_RADIUS_NODES;

/** How near (map points) a hostile armed vehicle refuses a site: as far as a siege vehicle out of its hold
 *  stance looks for a target, past its shot's own reach. Measured at the anchor, and for a holding vehicle
 *  as for an attacker, as {@link CONTESTED_GROUND_RADIUS_NODES} is. */
export const CONTESTED_SIEGE_RADIUS_POINTS = VEHICLE_SCAN_RADIUS_POINTS;

export interface ContestedGround {
  readonly contested: (hx: number, hy: number) => boolean;
  /** Names the contesters whose radius reaches into the node box, so a memo over that box knows when one
   *  of them moved. */
  readonly keyWithin: (minHx: number, maxHx: number, minHy: number, maxHy: number) => string;
}

const NO_CONTESTERS: readonly HalfCellNode[] = [];

type CoarseCells = Map<number, Map<number, HalfCellNode[]>>;

/** Contesters of one reach, bucketed in coarse cells `edge` nodes a side: no node `reaches` accepts lies
 *  farther than `edge` from its contester on either axis, so a query reads at most nine cells. */
interface ContesterGrid {
  readonly edge: number;
  readonly reaches: (c: HalfCellNode, hx: number, hy: number) => boolean;
  readonly cells: CoarseCells;
}

function fighterGrid(): ContesterGrid {
  return {
    edge: CONTESTED_GROUND_RADIUS_NODES,
    reaches: (c, hx, hy) => Math.abs(c.hx - hx) + Math.abs(c.hy - hy) <= CONTESTED_GROUND_RADIUS_NODES,
    cells: new Map(),
  };
}

/** A node within `r` map points lies at most `r` rows and `r` half-cell columns off. */
function siegeGrid(): ContesterGrid {
  return {
    edge: CONTESTED_SIEGE_RADIUS_POINTS,
    reaches: (c, hx, hy) => hexDistanceBetween(c.hx, c.hy, hx, hy) <= CONTESTED_SIEGE_RADIUS_POINTS,
    cells: new Map(),
  };
}

interface ContestedMemo {
  readonly version: number;
  readonly fogGeneration: number;
  readonly ground: ContestedGround;
}

/** One scan per world mutation and fog rebuild, shared by the command, the AI search, and every frame the
 *  app probes between ticks. Derived read-state, never hashed. */
const memo = new WeakMap<World, Map<number, ContestedMemo>>();

/**
 * The ground `player` may not build on right now: every node within {@link CONTESTED_GROUND_RADIUS_NODES}
 * of a living fighter or an unarmed vehicle (a cart or ship), or {@link CONTESTED_SIEGE_RADIUS_POINTS} of an
 * armed one (a catapult), the seat can see and whose owner fights it ({@link fightsPlayer}). A vehicle on the
 * map contests crewed or not (project rule). Civilians and animals are no army, and a garrison at its post
 * is a fortification rather than one, so none of them contest.
 */
export function contestedGroundFor(
  world: World,
  content: ContentSet,
  fog: FogState | undefined,
  player: number,
): ContestedGround {
  const version = world.mutationVersion;
  const fogGeneration = fog?.generation ?? -1;
  let perPlayer = memo.get(world);
  if (perPlayer === undefined) {
    perPlayer = new Map();
    memo.set(world, perPlayer);
  }
  const held = perPlayer.get(player);
  if (held !== undefined && held.version === version && held.fogGeneration === fogGeneration) {
    return held.ground;
  }
  const ground = scanContestedGround(world, content, fog, player);
  perPlayer.set(player, { version, fogGeneration, ground });
  return ground;
}

/** The footprint rule and, for an owned placement, the seat's site reach ({@link siteReachFor}) unless
 *  `withinReach` is off, the contested-ground rule and the ground a lobby peace keeps the seat off
 *  ({@link peaceGroundFor}), as one probe: the placement command, the computer players' site search and
 *  the placement ghost read the same verdict. */
export function seatPlacementProbe(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  fog: FogState | undefined,
  buildingType: number,
  tribe: number | undefined,
  player: number | undefined,
  withinReach = true,
): PlacementProbe {
  const footprint = placementProbe(world, content, terrain, buildingType, tribe);
  if (player === undefined) return footprint;
  const ground = contestedGroundFor(world, content, fog, player);
  const reach = withinReach ? siteReachFor(world, player) : null;
  const peace = peaceGroundFor(world, player);
  return {
    canPlace: (x, y) =>
      footprint.canPlace(x, y) &&
      (reach?.reaches(x, y) ?? true) &&
      !ground.contested(x, y) &&
      !(peace?.bars(x, y) ?? false),
  };
}

function scanContestedGround(
  world: World,
  content: ContentSet,
  fog: FogState | undefined,
  player: number,
): ContestedGround {
  const grids = [fighterGrid(), siegeGrid()] as const;
  const [fighters, siege] = grids;
  if (isValidPlayer(player)) {
    const contests = (e: Entity, grid: ContesterGrid): void => {
      const owner = world.get(e, Owner).player;
      if (owner === player || !fightsPlayer(world, owner, player)) return;
      const health = world.tryGet(e, Health);
      if (health === undefined || health.hitpoints <= 0) return;
      const p = world.tryGet(e, Position);
      if (p === undefined || !playerSeesEntity(world, fog, player, e)) return;
      const node = { hx: nodeHxOfPosition(p.x, p.y), hy: nodeHyOfPosition(p.x, p.y) };
      cellFor(grid.cells, coarseOf(node.hx, grid.edge), coarseOf(node.hy, grid.edge)).push(node);
    };
    for (const e of world.query(Settler, Owner)) {
      if (isFighterJob(content, world.get(e, Settler).jobType) && standsAtPost(world, e) === null) {
        contests(e, fighters);
      }
    }
    // A carried vehicle has no Position, so only one standing on the map contests.
    for (const e of world.query(Vehicle, Owner)) {
      contests(e, vehicleWeapon({ content }, world.get(e, Vehicle)) === null ? fighters : siege);
    }
  }
  return {
    contested: (hx, hy) => gridContests(fighters, hx, hy) || gridContests(siege, hx, hy),
    keyWithin: (minHx, maxHx, minHy, maxHy) => {
      const parts: string[] = [];
      for (const [i, { cells, edge }] of grids.entries()) {
        for (let cx = coarseOf(minHx - edge, edge); cx <= coarseOf(maxHx + edge, edge); cx++) {
          for (let cy = coarseOf(minHy - edge, edge); cy <= coarseOf(maxHy + edge, edge); cy++) {
            for (const c of contestersIn(cells, cx, cy)) parts.push(`${i}:${c.hx},${c.hy}`);
          }
        }
      }
      return parts.join(';');
    },
  };
}

function gridContests(grid: ContesterGrid, hx: number, hy: number): boolean {
  if (grid.cells.size === 0) return false; // most maps have no hostile vehicle in sight
  const cx = coarseOf(hx, grid.edge);
  const cy = coarseOf(hy, grid.edge);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (const c of contestersIn(grid.cells, cx + dx, cy + dy)) {
        if (grid.reaches(c, hx, hy)) return true;
      }
    }
  }
  return false;
}

function coarseOf(node: number, edge: number): number {
  return Math.floor(node / edge);
}

function contestersIn(cells: CoarseCells, cx: number, cy: number): readonly HalfCellNode[] {
  return cells.get(cx)?.get(cy) ?? NO_CONTESTERS;
}

function cellFor(cells: CoarseCells, cx: number, cy: number): HalfCellNode[] {
  let column = cells.get(cx);
  if (column === undefined) {
    column = new Map();
    cells.set(cx, column);
  }
  let cell = column.get(cy);
  if (cell === undefined) {
    cell = [];
    column.set(cy, cell);
  }
  return cell;
}
