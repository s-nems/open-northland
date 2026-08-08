import { IDLE_JOB as SIM_IDLE_JOB, type WorldSnapshot } from '@open-northland/sim';
import { readNumField, readStockpileAmounts } from '../snapshot/index.js';

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
  /** Per-good totals across the player's stores, ascending by `goodType`; zero entries omitted. */
  readonly stocks: readonly StockCount[];
}

/** A person's job (`Settler.jobType`), or {@link IDLE_JOB} when it has none. A job id of 0 is valid, so
 *  idle is detected by type, never by a falsy test. */
function jobTypeOf(components: Readonly<Record<string, unknown>>): number {
  return readNumField(components, 'Settler', 'jobType') ?? IDLE_JOB;
}

/**
 * Build one player's {@link HudModel} from a frame {@link WorldSnapshot}. Membership is `Owner.player`,
 * not `tribe`: a seat routinely fields several tribes and a tribe is routinely split across seats, so
 * only the owner answers "what do I command". A neutral entity carries no `Owner` and counts for nobody,
 * which is stricter than the sim's `ownersCompatible` side rule - a neutral store every seat may draw
 * from would show in none of their totals. No decoded map authors one.
 * Output ordering is total (sorted by id), so the same snapshot yields an identical model every call.
 */
export function buildHud(snapshot: WorldSnapshot, player: number): HudModel {
  let population = 0;
  const jobCounts = new Map<number, number>();
  const stockTotals = new Map<number, number>();

  for (const entity of snapshot.entities) {
    const components = entity.components;
    if (readNumField(components, 'Owner', 'player') !== player) continue;

    // The `Person` marker is the sim's own population query key, so wildlife and a claimed animal are
    // left out here the same way.
    if ('Person' in components) {
      population++;
      const jobType = jobTypeOf(components);
      jobCounts.set(jobType, (jobCounts.get(jobType) ?? 0) + 1);
    }

    if ('Building' in components) {
      for (const [goodType, amount] of readStockpileAmounts(components)) {
        stockTotals.set(goodType, (stockTotals.get(goodType) ?? 0) + amount);
      }
    }
  }

  // Sort explicitly: these maps are filled in entity-iteration order, not by key.
  const jobs: JobCount[] = [...jobCounts.entries()]
    .map(([jobType, count]) => ({ jobType, count }))
    .sort((a, b) => a.jobType - b.jobType);
  const stocks: StockCount[] = [...stockTotals.entries()]
    .filter(([, amount]) => amount !== 0)
    .map(([goodType, amount]) => ({ goodType, amount }))
    .sort((a, b) => a.goodType - b.goodType);

  return { tick: snapshot.tick, player, population, jobs, stocks };
}
