import {
  type Fixed,
  hexDistanceBetween,
  nodeOfPosition,
  IDLE_JOB as SIM_IDLE_JOB,
  WALK_RANGE_NODES,
  type WorldSnapshot,
} from '@open-northland/sim';
import { readNumField, readPosition, readStockpileAmounts } from '../snapshot/index.js';

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
  /** Per-good totals across the player's stores and the ground piles its signposts reach, ascending
   *  by `goodType`; zero entries omitted. */
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

/** The half-cell node under an entity's `Position`, or null for one that stands nowhere. */
function nodeOf(components: Readonly<Record<string, unknown>>): HalfCellNode | null {
  const p = readPosition(components);
  return p === null ? null : nodeOfPosition(p.x as Fixed, p.y as Fixed);
}

/**
 * Build one player's {@link HudModel} from a frame {@link WorldSnapshot}. Membership is `Owner.player`,
 * not `tribe`: a seat routinely fields several tribes and a tribe is routinely split across seats, so
 * only the owner answers "what do I command". A neutral entity carries no `Owner` and counts for nobody,
 * which is stricter than the sim's `ownersCompatible` side rule - a neutral store every seat may draw
 * from would show in none of their totals. No decoded map authors one.
 *
 * Stock is every owned building's pile plus the ground piles inside the seat's signpost network: a
 * `GroundDrop` strictly under `WALK_RANGE_NODES` of one of the seat's posts. An approximation of the
 * collecting settler's own limit (`networkLimitAt`), keeping its post-range term and ignoring the
 * collector's radius, group catching and terrain connectivity; only a gatherer takes a pile, never a
 * carrier.
 * Output ordering is total (sorted by id), so the same snapshot yields an identical model every call.
 */
export function buildHud(snapshot: WorldSnapshot, player: number): HudModel {
  let population = 0;
  const jobCounts = new Map<number, { count: number; female: number }>();
  const stockTotals = new Map<number, number>();
  const addStock = (components: Readonly<Record<string, unknown>>): void => {
    for (const [goodType, amount] of readStockpileAmounts(components)) {
      stockTotals.set(goodType, (stockTotals.get(goodType) ?? 0) + amount);
    }
  };
  const posts: HalfCellNode[] = [];
  const piles: Readonly<Record<string, unknown>>[] = [];

  for (const entity of snapshot.entities) {
    const components = entity.components;
    // A haulable ground pile belongs to nobody; whether it counts is settled below, by the posts.
    if ('GroundDrop' in components) {
      piles.push(components);
      continue;
    }
    if (readNumField(components, 'Owner', 'player') !== player) continue;
    if ('Signpost' in components) {
      const node = nodeOf(components);
      if (node !== null) posts.push(node);
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

    if ('Building' in components) addStock(components);
  }
  for (const pile of piles) {
    const node = nodeOf(pile);
    if (
      node !== null &&
      posts.some((post) => hexDistanceBetween(post.hx, post.hy, node.hx, node.hy) < WALK_RANGE_NODES)
    ) {
      addStock(pile);
    }
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
