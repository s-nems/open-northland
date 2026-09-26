import type { ContentSet } from '@open-northland/data';
import { diplomacyStance, Health, isValidPlayer, Owner, Position, Settler } from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import { type HalfCellNode, nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { type PlacementProbe, placementProbe } from '../footprint/index.js';
import { isFighterJob } from '../readviews/index.js';
import { signpostNetwork } from '../signposts/index.js';
import { type FogState, playerSeesEntity } from '../vision/index.js';
import { SIGHT_RADIUS_NODES } from './targeting.js';
import { standsAtPost } from './tower-post.js';

/**
 * How near (Manhattan half-cell nodes) a hostile fighter refuses a site: a fighter who can see the ground
 * strikes the foundation the tick it stands. Deliberate divergence: the original places freely under an
 * enemy army (observation). Approximation on three counts: measured at the anchor rather than the walls,
 * with the plain sight radius rather than a bow's reach, and for a holding guard as for an attacker.
 */
export const CONTESTED_GROUND_RADIUS_NODES = SIGHT_RADIUS_NODES;

export interface ContestedGround {
  readonly contested: (hx: number, hy: number) => boolean;
  /** Names the fighters whose radius reaches into the node box, so a memo over that box knows when one
   *  of them moved. */
  readonly keyWithin: (minHx: number, maxHx: number, minHy: number, maxHy: number) => string;
}

/** A seat's whole placement rule: the footprint probe, off the ground a hostile army contests. */
export interface PlayerPlacementProbe extends PlacementProbe {
  readonly contestedKeyWithin: ContestedGround['keyWithin'];
}

const NO_FIGHTERS: readonly HalfCellNode[] = Object.freeze([]);

/** Coarse cells of one radius an edge: a fighter within the radius of a node lies in that node's cell or a
 *  neighbour, so a query reads at most nine cells. */
type CoarseCells = Map<number, Map<number, HalfCellNode[]>>;

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
 * of a living fighter the seat can see whose owner holds an `enemy` stance toward it. Civilians and animals
 * are no army, and a garrison at its post is a fortification rather than one, so none of them contest.
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

/** The footprint rule, with the placer's own signposts passable, and for an owned placement the
 *  contested-ground rule, as one probe. */
export function seatPlacementProbe(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  fog: FogState | undefined,
  buildingType: number,
  player: number | undefined,
): PlayerPlacementProbe {
  const ownSignposts = player === undefined ? [] : (signpostNetwork(world).get(player) ?? []);
  const footprint = placementProbe(world, content, terrain, buildingType, ownSignposts);
  if (player === undefined)
    return { canPlace: (x, y) => footprint.canPlace(x, y), contestedKeyWithin: () => '' };
  const ground = contestedGroundFor(world, content, fog, player);
  return {
    canPlace: (x, y) => footprint.canPlace(x, y) && !ground.contested(x, y),
    contestedKeyWithin: ground.keyWithin,
  };
}

function scanContestedGround(
  world: World,
  content: ContentSet,
  fog: FogState | undefined,
  player: number,
): ContestedGround {
  const cells: CoarseCells = new Map();
  if (isValidPlayer(player)) {
    for (const e of world.query(Settler, Owner)) {
      const owner = world.get(e, Owner).player;
      if (owner === player || diplomacyStance(world, owner, player) !== 'enemy') continue;
      if (!isFighterJob(content, world.get(e, Settler).jobType)) continue;
      const health = world.tryGet(e, Health);
      if (health === undefined || health.hitpoints <= 0) continue;
      const p = world.tryGet(e, Position);
      if (p === undefined || standsAtPost(world, e) !== null) continue;
      if (!playerSeesEntity(world, fog, player, e)) continue;
      const node = { hx: nodeHxOfPosition(p.x, p.y), hy: nodeHyOfPosition(p.y) };
      cellFor(cells, coarseOf(node.hx), coarseOf(node.hy)).push(node);
    }
  }
  return {
    contested: (hx, hy) => {
      const cx = coarseOf(hx);
      const cy = coarseOf(hy);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const f of fightersIn(cells, cx + dx, cy + dy)) {
            if (Math.abs(f.hx - hx) + Math.abs(f.hy - hy) <= CONTESTED_GROUND_RADIUS_NODES) return true;
          }
        }
      }
      return false;
    },
    keyWithin: (minHx, maxHx, minHy, maxHy) => {
      const parts: string[] = [];
      const r = CONTESTED_GROUND_RADIUS_NODES;
      for (let cx = coarseOf(minHx - r); cx <= coarseOf(maxHx + r); cx++) {
        for (let cy = coarseOf(minHy - r); cy <= coarseOf(maxHy + r); cy++) {
          for (const f of fightersIn(cells, cx, cy)) parts.push(`${f.hx},${f.hy}`);
        }
      }
      return parts.join(';');
    },
  };
}

function coarseOf(node: number): number {
  return Math.floor(node / CONTESTED_GROUND_RADIUS_NODES);
}

function fightersIn(cells: CoarseCells, cx: number, cy: number): readonly HalfCellNode[] {
  return cells.get(cx)?.get(cy) ?? NO_FIGHTERS;
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
