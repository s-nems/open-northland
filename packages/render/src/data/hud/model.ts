import type { SignpostReachView } from '@open-northland/sim';
import { IDLE_JOB as SIM_IDLE_JOB, type WorldSnapshot } from '@open-northland/sim';
import { empireInventoryOf } from './inventory.js';
import { hudTotalsOf } from './totals.js';

/**
 * Turns a {@link WorldSnapshot} into a flat {@link HudModel}. Aggregates come from the read-only
 * snapshot rather than the live component stores, which `render` may never touch.
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
  /** The `Owner.player` slot every figure below is counted for; null for nobody's model, whose figures
   *  are all zero (a spectator watching the whole map rather than one seat). */
  readonly player: number | null;
  /** Every living person the player owns, working or not, baby or adult; wildlife is not counted. */
  readonly population: number;
  /** Per-job head-counts, ascending by `jobType`. */
  readonly jobs: readonly JobCount[];
  /** Per-good totals of everything the player holds: its stores and hulls, what its people carry, and
   *  the ground heaps inside its reach; ascending by `goodType`, zero entries omitted. */
  readonly stocks: readonly StockCount[];
}

/** Live stock uses the sim's terrain reach. A snapshot-only caller keeps the mapless inventory estimate. */
export function buildHud(
  snapshot: WorldSnapshot,
  player: number,
  reach?: SignpostReachView | null,
): HudModel {
  const totals = hudTotalsOf(snapshot, player);
  if (totals === undefined) return { tick: snapshot.tick, player, population: 0, jobs: [], stocks: [] };

  const jobs: JobCount[] = [...totals.jobs.entries()]
    .map(([jobType, { count, female }]) => ({ jobType, count, female }))
    .sort((a, b) => a.jobType - b.jobType);
  const stockTotals = new Map(totals.owned);
  for (const [goodType, amount] of totals.heapStock) {
    stockTotals.set(goodType, (stockTotals.get(goodType) ?? 0) + amount);
  }
  const stocks = stockCounts(reach === undefined ? stockTotals : empireInventoryOf(snapshot, reach));

  return { tick: snapshot.tick, player, population: totals.population, jobs, stocks };
}

/** Nobody's model at `tick`: every figure zero, so the bar shows a seatless view as empty. */
export function emptyHud(tick: number): HudModel {
  return { tick, player: null, population: 0, jobs: [], stocks: [] };
}

export function stockCounts(totals: ReadonlyMap<number, number>): StockCount[] {
  return [...totals.entries()]
    .filter(([, amount]) => amount !== 0)
    .map(([goodType, amount]) => ({ goodType, amount }))
    .sort((a, b) => a.goodType - b.goodType);
}
