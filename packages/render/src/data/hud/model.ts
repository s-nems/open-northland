import type { WorldSnapshot } from '@open-northland/sim';
import { systems } from '@open-northland/sim';
import { readStockpileAmounts } from '../snapshot/index.js';

/**
 * The pure HUD-model layer: turns a {@link WorldSnapshot} into a flat {@link HudModel} the GPU/DOM
 * layer lays out as text + bars.
 *
 * It re-derives the aggregates of the sim's own read views (`tribeStocks`/`tribePopulation`/
 * `tribePopulationByJob`) from the frozen snapshot rather than calling them, because `render` must
 * never read the live component stores (docs/ARCHITECTURE.md). The snapshot is taken at a tick
 * boundary, and counts/sums are order-independent, so the values match the sim views by construction.
 */

/** The HUD job-key for an idle, job-seeking adult — the sim's own sentinel, re-exported so a consumer
 *  reading {@link JobCount.jobType} can name it without importing sim. */
export const IDLE_JOB = systems.IDLE_JOB;

/** A single per-job tally row of the HUD: a `jobType` id (or {@link IDLE_JOB}) and its head-count. */
export interface JobCount {
  /** A real `JobType.typeId`, or {@link IDLE_JOB} (`-1`) for an unassigned adult. Keys 1–4 are the
   * non-working baby/child age classes (the `jobType`-as-life-stage model); the consumer partitions. */
  readonly jobType: number;
  readonly count: number;
}

/** A single per-good stock row of the HUD: a `goodType` id and the tribe-wide total held. */
export interface StockCount {
  readonly goodType: number;
  readonly amount: number;
}

/**
 * The display model for one tribe's HUD at a tick — flat, sorted, plain data. The pixel layer reads
 * these arrays in paint order.
 */
export interface HudModel {
  /** The tick this model was built for (the snapshot's tick) — a HUD can show "tick N". */
  readonly tick: number;
  /** The tribe this model summarizes. */
  readonly tribe: number;
  /** Total living settlers of the tribe (every settler, idle or working, baby or adult — all mouths). */
  readonly population: number;
  /** Per-job head-counts, ascending by `jobType` (idle's `-1` sorts first) — a stable display order. */
  readonly jobs: readonly JobCount[];
  /** Per-good stock totals across the tribe's stores, ascending by `goodType`; zero entries omitted. */
  readonly stocks: readonly StockCount[];
}

/** The plain-cloned `Settler` component as it appears in a snapshot (a subset of the sim shape). */
interface SettlerValue {
  tribe?: unknown;
  jobType?: unknown;
}

/** The plain-cloned `Building` component as it appears in a snapshot. */
interface BuildingValue {
  tribe?: unknown;
}

/**
 * Read an entity's `Settler` component (tribe + jobType), or `null` if it isn't a settler. Total: a
 * missing or malformed `tribe` field reads as "not a countable settler".
 */
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
 * `tribePopulation`, `tribePopulationByJob`, and `tribeStocks`:
 *  - population = count of the tribe's `Settler`s (every settler is a mouth, idle or not).
 *  - jobs = per-`jobType` head-count; an idle adult (`jobType === null`) is keyed by {@link IDLE_JOB}.
 *  - stocks = per-`goodType` total across the tribe's stores (any `Building` with a `Stockpile`),
 *    summed from each store's snapshot `amounts`; a good summing to `0` everywhere is omitted.
 *
 * Output ordering is explicit and total (sorted by id), so the same snapshot yields a byte-identical
 * model every call.
 */
export function buildHud(snapshot: WorldSnapshot, tribe: number): HudModel {
  let population = 0;
  const jobCounts = new Map<number, number>();
  const stockTotals = new Map<number, number>();

  for (const entity of snapshot.entities) {
    const settler = settlerOf(entity.components);
    if (settler !== null && settler.tribe === tribe) {
      population++;
      // `jobType` is `number | null`; fold null onto the idle sentinel with `??` (a job id of 0 is
      // valid, so `||` would mis-bucket it).
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

  // Explicit ascending-id sort so the display order is total + stable (the snapshot's Maps were
  // already key-sorted, but jobCounts/stockTotals are built here in entity-iteration order).
  const jobs: JobCount[] = [...jobCounts.entries()]
    .map(([jobType, count]) => ({ jobType, count }))
    .sort((a, b) => a.jobType - b.jobType);
  const stocks: StockCount[] = [...stockTotals.entries()]
    .filter(([, amount]) => amount !== 0) // drop a good that nets to zero across all stores
    .map(([goodType, amount]) => ({ goodType, amount }))
    .sort((a, b) => a.goodType - b.goodType);

  return { tick: snapshot.tick, tribe, population, jobs, stocks };
}
