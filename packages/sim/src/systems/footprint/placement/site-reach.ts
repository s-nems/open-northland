import {
  Health,
  isValidPlayer,
  Owner,
  Position,
  Signpost,
  UnderConstruction,
  Upgrading,
  WALK_RANGE_NODES,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import {
  type NodeArea,
  nodeHxOfPosition,
  nodeHyOfPosition,
  rowReachLeft,
  rowReachRight,
} from '../../../nav/halfcell.js';
import { ownedBuildings, ownedSettlers } from '../../ai-shared/seat-roster.js';

/**
 * How far from one of its own people, standing buildings or signposts a seat may lay a building, in map
 * points (`hexDistance`): the walk range a civilian plans in one go, about 25 cells. A project rule the
 * owner asked for, not taken from the original, so nobody lays a site across the map where none of the
 * seat's people stands.
 */
export const SITE_REACH_RADIUS_NODES = WALK_RANGE_NODES;

export interface SiteReach {
  readonly reaches: (hx: number, hy: number) => boolean;
  /** {@link reaches} over every node of `area`, row-major from its minimum corner, 1 where it reaches. */
  readonly over: (area: NodeArea) => Uint8Array;
}

/** The seat's distinct source nodes by row: `rows` ascending, `columns.get(row)` ascending. */
interface SourceRows {
  readonly rows: Int32Array;
  readonly columns: ReadonlyMap<number, Int32Array>;
}

interface ReachMemo {
  readonly version: number;
  readonly reach: SiteReach;
}

/** One source walk per world mutation and seat, shared by the command, the computer players' site search
 *  and every frame the placement ghost probes between ticks. Derived read-state, never hashed. */
const memo = new WeakMap<World, Map<number, ReachMemo>>();

/**
 * The ground `player` may lay a building on: every node within {@link SITE_REACH_RADIUS_NODES} of one of
 * its living people, standing buildings or signposts. A foundation is no anchor, or a chain of sites
 * would cross the map before anyone walked there; its builders carry the reach out with them. A standing
 * building under upgrade keeps its reach. Cost: the seat's own entities once per mutation, then per
 * queried row the source rows within the radius, so an area answer scales with the area, not the town.
 */
export function siteReachFor(world: World, player: number): SiteReach {
  let perPlayer = memo.get(world);
  if (perPlayer === undefined) {
    perPlayer = new Map();
    memo.set(world, perPlayer);
  }
  const held = perPlayer.get(player);
  if (held !== undefined && held.version === world.mutationVersion) return held.reach;
  const reach = reachOver(sourceRows(world, player));
  perPlayer.set(player, { version: world.mutationVersion, reach });
  return reach;
}

function sourceRows(world: World, player: number): SourceRows {
  const byRow = new Map<number, number[]>();
  const add = (e: Entity): void => {
    const p = world.tryGet(e, Position);
    if (p === undefined) return;
    const hy = nodeHyOfPosition(p.x, p.y);
    const row = byRow.get(hy);
    if (row === undefined) byRow.set(hy, [nodeHxOfPosition(p.x, p.y)]);
    else row.push(nodeHxOfPosition(p.x, p.y));
  };
  if (isValidPlayer(player)) {
    for (const e of ownedSettlers(world, player)) {
      const health = world.tryGet(e, Health);
      if (health === undefined || health.hitpoints > 0) add(e);
    }
    for (const e of ownedBuildings(world, player)) {
      if (!world.has(e, UnderConstruction) || world.has(e, Upgrading)) add(e);
    }
    for (const e of world.query(Signpost, Owner)) {
      if (world.get(e, Owner).player === player) add(e);
    }
  }
  const columns = new Map<number, Int32Array>();
  for (const [hy, hxs] of byRow) {
    const sorted = Int32Array.from(hxs).sort();
    let distinct = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (i === 0 || sorted[i] !== sorted[distinct - 1]) sorted[distinct++] = sorted[i] as number;
    }
    columns.set(hy, sorted.subarray(0, distinct));
  }
  return { rows: Int32Array.from(columns.keys()).sort(), columns };
}

/** The first index of the ascending `xs` not below `x`. */
function lowerBound(xs: Int32Array, x: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((xs[mid] as number) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function reachOver({ rows, columns }: SourceRows): SiteReach {
  const radius = SITE_REACH_RADIUS_NODES;
  // A source at column 0 of row `origin.hy` reaches a row from `rowReachLeft` to `rowReachRight`; a source
  // at `sx` shifts both by `sx`, as the extent depends on the two rows alone. Reused, so a query allocates
  // nothing per row.
  const origin = { hx: 0, hy: 0 };
  /** Calls `visit` with each source row within the radius of row `hy`, `origin` set to it. */
  const eachSourceRow = (
    hy: number,
    visit: (xs: Int32Array, left: number, right: number) => boolean,
  ): void => {
    for (let r = lowerBound(rows, hy - radius); r < rows.length && (rows[r] as number) <= hy + radius; r++) {
      origin.hy = rows[r] as number;
      const xs = columns.get(origin.hy);
      if (xs === undefined) continue;
      if (visit(xs, rowReachLeft(origin, hy, radius), rowReachRight(origin, hy, radius))) return;
    }
  };
  return {
    reaches: (hx, hy) => {
      let found = false;
      eachSourceRow(hy, (xs, left, right) => {
        // A source at `sx` covers `hx` when sx + left <= hx <= sx + right.
        const i = lowerBound(xs, hx - right);
        found = i < xs.length && (xs[i] as number) <= hx - left;
        return found;
      });
      return found;
    },
    over: (area) => {
      const width = area.maxHx - area.minHx + 1;
      const out = new Uint8Array(width * (area.maxHy - area.minHy + 1));
      for (let hy = area.minHy; hy <= area.maxHy; hy++) {
        const base = (hy - area.minHy) * width - area.minHx;
        eachSourceRow(hy, (xs, left, right) => {
          // Equal-width spans in column order, so neighbours merge into runs filled once each.
          let i = lowerBound(xs, area.minHx - right);
          while (i < xs.length && (xs[i] as number) + left <= area.maxHx) {
            const start = (xs[i] as number) + left;
            let end = (xs[i] as number) + right;
            i++;
            while (i < xs.length && (xs[i] as number) + left <= end + 1) end = (xs[i++] as number) + right;
            // One run across the whole row leaves nothing for the remaining source rows to add.
            if (start <= area.minHx && end >= area.maxHx) {
              out.fill(1, base + area.minHx, base + area.maxHx + 1);
              return true;
            }
            out.fill(1, base + Math.max(start, area.minHx), base + Math.min(end, area.maxHx) + 1);
          }
          return false;
        });
      }
      return out;
    },
  };
}
