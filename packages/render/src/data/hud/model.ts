import { IDLE_JOB as SIM_IDLE_JOB, type WorldSnapshot } from '@open-northland/sim';
import { readStockpileAmounts } from '../snapshot/index.js';

/**
 * Turns a {@link WorldSnapshot} into a flat {@link HudModel}. The aggregates of the sim's own read
 * views are re-derived from the read-only snapshot rather than called, because `render` must never
 * read the live component stores. The snapshot is taken at a tick boundary and counts and sums are
 * order-independent, so the values match those views by construction.
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
  readonly tribe: number;
  /** Every living settler of the tribe, working or not, baby or adult. */
  readonly population: number;
  /** Per-job head-counts, ascending by `jobType`. */
  readonly jobs: readonly JobCount[];
  /** Per-good totals across the tribe's stores, ascending by `goodType`; zero entries omitted. */
  readonly stocks: readonly StockCount[];
}

/** The plain-cloned `Settler` component as it appears in a snapshot. */
interface SettlerValue {
  tribe?: unknown;
  jobType?: unknown;
}

/** The plain-cloned `Building` component as it appears in a snapshot. */
interface BuildingValue {
  tribe?: unknown;
}

/** The entity's `Settler` component, or null when `tribe` is missing or not a number. */
function settlerOf(components: Readonly<Record<string, unknown>>): SettlerValue | null {
  const s = components.Settler as SettlerValue | undefined;
  if (s === undefined || typeof s.tribe !== 'number') return null;
  return s;
}

function buildingOf(components: Readonly<Record<string, unknown>>): BuildingValue | null {
  const b = components.Building as BuildingValue | undefined;
  if (b === undefined || typeof b.tribe !== 'number') return null;
  return b;
}

/**
 * Build a tribe's {@link HudModel} from a frame {@link WorldSnapshot}, mirroring the sim read views
 * `tribePopulation`, `tribePopulationByJob` and `tribeStocks`; population counts the tribe's people, not
 * its wildlife. Output ordering is total (sorted by id), so the same snapshot yields an identical model
 * every call.
 */
export function buildHud(snapshot: WorldSnapshot, tribe: number): HudModel {
  let population = 0;
  const jobCounts = new Map<number, number>();
  const stockTotals = new Map<number, number>();

  for (const entity of snapshot.entities) {
    const settler = settlerOf(entity.components);
    if (settler !== null && settler.tribe === tribe) {
      population++;
      // A job id of 0 is valid, so idle is detected by type, never by a falsy test.
      const jobType = typeof settler.jobType === 'number' ? settler.jobType : IDLE_JOB;
      jobCounts.set(jobType, (jobCounts.get(jobType) ?? 0) + 1);
    }

    const building = buildingOf(entity.components);
    if (building !== null && building.tribe === tribe) {
      for (const [goodType, amount] of readStockpileAmounts(entity.components)) {
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

  return { tick: snapshot.tick, tribe, population, jobs, stocks };
}
