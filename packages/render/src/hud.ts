import type { WorldSnapshot } from '@vinland/sim';

/**
 * The PURE HUD-model layer — the part of the on-screen HUD an agent CAN self-verify, exactly
 * analogous to {@link buildScene} for the world view (see scene.ts).
 *
 * It turns a {@link WorldSnapshot} into a flat, structured {@link HudModel} (a tribe's population
 * summary, per-job head-counts, and per-good stock totals) — plain data the GPU/DOM layer (the
 * un-self-verifiable pixel half, deferred to a human) lays out as text + bars. Keeping the
 * *aggregation* here means the load-bearing HUD logic — *which* number a panel shows — is
 * unit-testable without a screen (see test/hud.test.ts), and the human only judges the typography.
 *
 * Why off the SNAPSHOT, not the sim read views: `render` is a pure consumer of sim state and must
 * never read the live component stores (docs/ARCHITECTURE.md; the determinism contract). The sim's
 * own read views (`systems.tribeStocks`/`tribePopulation`/`tribePopulationByJob`) take a live
 * `World`; the HUD instead re-derives the *same* aggregates from the frozen, plain-cloned snapshot
 * the renderer already holds — the snapshot is taken at a tick boundary, so the HUD can't observe a
 * half-applied mutation. The values match the sim views by construction (a count / a sum is
 * order-independent), but this path never re-enters the sim.
 */

/**
 * The HUD job-key for an **idle, job-seeking adult** (`Settler.jobType === null`). `-1`, outside the
 * `0..` `JobType.typeId` space (real ids start at 1; `0` is the valid `none` id), so it can never
 * collide with a real job's count — the same sentinel the sim's `tribePopulationByJob` view uses.
 */
export const IDLE_JOB = -1;

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
 * these arrays in order; everything is already deterministically ordered so the panel never reshuffles
 * between equal frames.
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
 * Read the tribe a snapshot entity belongs to via a marker component, or `null` if it carries
 * neither a `Settler` nor a `Building` (the two tribe-owning markers the HUD aggregates). Total: a
 * missing/malformed `tribe` field reads as "not this entity's concern".
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
 * Read a snapshot `Stockpile`'s `amounts`. The snapshot clones a `Map` to a **sorted `[k, v]`
 * array** (see snapshot.ts `clonePlain`), so this returns that array shape directly — no live Map.
 * Total: a missing/malformed stockpile reads as empty.
 */
function stockpileAmounts(components: Readonly<Record<string, unknown>>): readonly [number, number][] {
  const sp = components.Stockpile as { amounts?: unknown } | undefined;
  if (sp === undefined || !Array.isArray(sp.amounts)) return [];
  const out: [number, number][] = [];
  for (const entry of sp.amounts) {
    if (Array.isArray(entry) && typeof entry[0] === 'number' && typeof entry[1] === 'number') {
      out.push([entry[0], entry[1]]);
    }
  }
  return out;
}

/**
 * Build a tribe's {@link HudModel} from a frame {@link WorldSnapshot} — the pure data half of the HUD.
 *
 * Mirrors the three world-state sim read views (`tribePopulation`, `tribePopulationByJob`,
 * `tribeStocks`) but sourced from the plain snapshot so `render` never reads the live stores:
 *  - **population** = count of the tribe's `Settler`s (every settler is a mouth, idle or not).
 *  - **jobs** = per-`jobType` head-count; an idle adult (`jobType === null`) is keyed by
 *    {@link IDLE_JOB} (`-1`, outside the `0..` id space, so it can't collide with a real job — the
 *    same sentinel + the same `?? IDLE_JOB` nullish fold the sim view uses, never `||`, because `0`
 *    (`none`) is a valid job id).
 *  - **stocks** = per-`goodType` total across the tribe's stores (any `Building` with a `Stockpile`),
 *    summed from each store's snapshot `amounts`; a good summing to `0` everywhere is omitted.
 *
 * Output ordering is explicit + total (sorted by id), so the same snapshot yields a byte-identical
 * model every call — the determinism that keeps the HUD from reshuffling between equal frames, and
 * lets a screenshot harness produce a reproducible panel. Floats never appear (all counts/amounts are
 * integers); even so this is `render`, where floats would be allowed.
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
      for (const [goodType, amount] of stockpileAmounts(entity.components)) {
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
