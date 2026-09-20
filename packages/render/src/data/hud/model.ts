import {
  type Fixed,
  hexDistanceBetween,
  nodeOfPosition,
  IDLE_JOB as SIM_IDLE_JOB,
  WALK_RANGE_NODES,
  type WorldSnapshot,
} from '@open-northland/sim';
import { readAmountPairs, readNumField, readPosition, readStockpileAmounts } from '../snapshot/index.js';

/**
 * Turns a {@link WorldSnapshot} into a flat {@link HudModel}. Aggregates are re-derived from the
 * read-only snapshot rather than read off the live component stores, which `render` may never touch.
 */

/** The sim's idle sentinel, re-exported so a HUD consumer can name it without importing sim. */
export const IDLE_JOB = SIM_IDLE_JOB;

export interface JobCount {
  /** A real `JobType.typeId`, or {@link IDLE_JOB} for an unassigned adult. Keys 1-4 are the
   *  non-working baby/child age classes, which the consumer partitions. */
  readonly jobType: number;
  readonly count: number;
  /** How many of `count` carry the sim's `Female` marker, so a consumer can split adults into women
   *  and men without a second scan. */
  readonly female: number;
}

export interface StockCount {
  readonly goodType: number;
  readonly amount: number;
}

export interface HudModel {
  readonly tick: number;
  /** The `Owner.player` slot every figure below is counted for. */
  readonly player: number;
  /** Every living person the player owns, working or not, baby or adult; wildlife is not counted. */
  readonly population: number;
  /** Per-job head-counts, ascending by `jobType`. */
  readonly jobs: readonly JobCount[];
  /** Per-good totals of everything the player holds: its stores and hulls, what its people carry, and
   *  the ground heaps inside its reach; ascending by `goodType`, zero entries omitted. */
  readonly stocks: readonly StockCount[];
}

/** A person's job (`Settler.jobType`), or {@link IDLE_JOB} when it has none. A job id of 0 is valid, so
 *  idle is detected by type, never by a falsy test. */
function jobTypeOf(components: Readonly<Record<string, unknown>>): number {
  return readNumField(components, 'Settler', 'jobType') ?? IDLE_JOB;
}

interface HalfCellNode {
  readonly hx: number;
  readonly hy: number;
}

/** The anchor bucket a node falls in: one square of `WALK_RANGE_NODES` on the half-cell lattice. */
const bucketKey = (hx: number, hy: number): string =>
  `${Math.floor(hx / WALK_RANGE_NODES)}:${Math.floor(hy / WALK_RANGE_NODES)}`;

/** The half-cell node under an entity's `Position`, or null for one that stands nowhere. */
function nodeOf(components: Readonly<Record<string, unknown>>): HalfCellNode | null {
  const p = readPosition(components);
  return p === null ? null : nodeOfPosition(p.x as Fixed, p.y as Fixed);
}

/**
 * Build one player's {@link HudModel} from a frame {@link WorldSnapshot}. Membership is `Owner.player`,
 * not `tribe`: a seat routinely fields several tribes and a tribe is routinely split across seats, so
 * only the owner answers "what do I command". An entity with no `Owner` counts for nobody unless it is
 * a heap on the ground, which the anchors below hand to whoever can reach it; a neutral store standing
 * in reach of two seats would therefore count for both. No decoded map authors one.
 *
 * Stock is every unit the seat holds, wherever it sits: the piles of its buildings and boat hulls, the
 * inventory a building keeps aside while it upgrades, the unit in a settler's hands, and every heap on
 * the ground (a felled trunk, an ore pile, a gatherer's yard heap, an evicted stack; none is owned)
 * strictly under `WALK_RANGE_NODES` of one of the seat's signposts or buildings. The ground term is an
 * approximation of the collecting settler's own limit (`networkLimitAt`): its post-range term, with
 * the seat's buildings standing in for a collector's own radius, and without group catching or terrain
 * connectivity. Counting the hands and the yard keeps the figure still while a gatherer walks a unit
 * from trunk to heap to store; nothing is consumed on that trip.
 * Output ordering is total (sorted by id), so the same snapshot yields an identical model every call.
 */
export function buildHud(snapshot: WorldSnapshot, player: number): HudModel {
  let population = 0;
  const jobCounts = new Map<number, { count: number; female: number }>();
  const stockTotals = new Map<number, number>();
  const addPairs = (pairs: readonly (readonly [number, number])[]): void => {
    for (const [goodType, amount] of pairs) {
      stockTotals.set(goodType, (stockTotals.get(goodType) ?? 0) + amount);
    }
  };
  const anchors: HalfCellNode[] = [];
  const heaps: Readonly<Record<string, unknown>>[] = [];

  for (const entity of snapshot.entities) {
    const components = entity.components;
    const owner = readNumField(components, 'Owner', 'player');
    if (owner === undefined) {
      // A heap on the ground belongs to nobody; whether it counts is settled below, by the anchors.
      if ('Stockpile' in components && 'Position' in components) heaps.push(components);
      continue;
    }
    if (owner !== player) continue;
    if ('Signpost' in components || 'Building' in components) {
      const node = nodeOf(components);
      if (node !== null) anchors.push(node);
    }

    // The `Person` marker is the sim's own population query key, so wildlife and a claimed animal are
    // left out here the same way.
    if ('Person' in components) {
      population++;
      const jobType = jobTypeOf(components);
      const tally = jobCounts.get(jobType) ?? { count: 0, female: 0 };
      tally.count++;
      if ('Female' in components) tally.female++;
      jobCounts.set(jobType, tally);
    }

    // An owned pile is a building's or a boat hull's; the ground never carries an owner.
    addPairs(readStockpileAmounts(components));
    const upgrading = components.Upgrading as { savedStock?: unknown } | undefined;
    if (upgrading !== undefined) addPairs(readAmountPairs(upgrading.savedStock));
    const carriedGood = readNumField(components, 'Carrying', 'goodType');
    const carriedAmount = readNumField(components, 'Carrying', 'amount');
    if (carriedGood !== undefined && carriedAmount !== undefined) addPairs([[carriedGood, carriedAmount]]);
  }
  // A hexagon of range r spans at most r columns and r rows each way, so an anchor within reach of a
  // heap sits in the heap's own `WALK_RANGE_NODES` bucket or one of its eight neighbours. Bucketing
  // the anchors once keeps the cost on the heaps beside a settlement; a seat spread across the map
  // would otherwise pay one distance test per anchor for every heap between its far corners.
  const anchorBuckets = new Map<string, HalfCellNode[]>();
  for (const anchor of anchors) {
    const key = bucketKey(anchor.hx, anchor.hy);
    const bucket = anchorBuckets.get(key);
    if (bucket === undefined) anchorBuckets.set(key, [anchor]);
    else bucket.push(anchor);
  }
  const inReach = (node: HalfCellNode): boolean => {
    const bx = Math.floor(node.hx / WALK_RANGE_NODES);
    const by = Math.floor(node.hy / WALK_RANGE_NODES);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = anchorBuckets.get(`${bx + dx}:${by + dy}`);
        if (bucket === undefined) continue;
        for (const anchor of bucket) {
          if (hexDistanceBetween(anchor.hx, anchor.hy, node.hx, node.hy) < WALK_RANGE_NODES) return true;
        }
      }
    }
    return false;
  };
  for (const heap of heaps) {
    const node = nodeOf(heap);
    if (node !== null && inReach(node)) addPairs(readStockpileAmounts(heap));
  }

  // Sort explicitly: these maps are filled in entity-iteration order, not by key.
  const jobs: JobCount[] = [...jobCounts.entries()]
    .map(([jobType, { count, female }]) => ({ jobType, count, female }))
    .sort((a, b) => a.jobType - b.jobType);
  const stocks: StockCount[] = [...stockTotals.entries()]
    .filter(([, amount]) => amount !== 0)
    .map(([goodType, amount]) => ({ goodType, amount }))
    .sort((a, b) => a.goodType - b.goodType);

  return { tick: snapshot.tick, player, population, jobs, stocks };
}
