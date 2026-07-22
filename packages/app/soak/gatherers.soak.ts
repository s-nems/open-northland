import { existsSync } from 'node:fs';
import {
  components,
  type Entity,
  FOG_MODE,
  harvestJobsOf,
  nodeOfPosition,
  type Simulation,
  systems,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr } from '../test/content/helpers.js';
import { realMapPath, realMapWorld } from '../test/content/real-map-world.js';
import { formatStallReport, type GathererSample, StallTracker } from './gatherer-stalls.js';
import { intEnv } from './knobs.js';

/**
 * The gatherer idle-loop soak — `npm run soak:gatherers`. It runs the browser session
 * `?map=magiczny_las&player=overseer&ai=0,1,2,3,4,5&fog=reveal` headless for tens of thousands of
 * ticks and reports every collector that stopped collecting: who, which good, from which tick, and
 * what its world looked like while it idled. This is a diagnostic tool, not a gate — the regression
 * it exists to catch is pinned at sim level, and `*.soak.ts` matches no other vitest config, which
 * is what keeps a 40k-tick run out of `npm test`, CI, and `bench:sim`.
 *
 * Knobs (env, all optional): `ON_SOAK_TICKS`, `ON_SOAK_MAP`, `ON_SOAK_SAMPLE_EVERY`,
 * `ON_SOAK_STALL_TICKS`.
 */

const { Carrying, CurrentAtomic, GatherSelection, Owner, Position, Resource, Settler, Stranded, WorkFlag } =
  components;

/** The reported session: every seat under AI, matching `ai=0,1,2,3,4,5`. */
const AI_SEATS = [0, 1, 2, 3, 4, 5];
const DEFAULT_MAP_ID = 'magiczny_las';
/** ~55 minutes of game time at 12 ticks/s — past the ~20k-tick mark the reported clay stall begins. */
const DEFAULT_TICKS = 40_000;
/** Sampling cadence. Fine enough to place a stall's onset within seconds of game time, coarse enough
 *  that the observer costs a fraction of a tick. */
const DEFAULT_SAMPLE_EVERY_TICKS = 25;
/** Unproductive span that counts as a stall: ~4 minutes of game time. Long enough that a legitimate
 *  walk to a distant patch, a meal, or a night's sleep never trips it. */
const DEFAULT_STALL_TICKS = 3_000;

/** A soak builds and runs a whole real-content world — far past vitest's default timeout. */
const SOAK_TIMEOUT_MS = 60 * 60_000;

function mapId(): string {
  const raw = process.env.ON_SOAK_MAP?.trim();
  return raw === undefined || raw === '' ? DEFAULT_MAP_ID : raw;
}

/** Every settler currently holding a gatherer trade, as one sample each. */
function sampleGatherers(sim: Simulation, harvestJobs: ReadonlySet<number>): GathererSample[] {
  const out: GathererSample[] = [];
  for (const e of sim.world.query(Settler, Owner)) {
    const settler = sim.world.get(e, Settler);
    const flag = sim.world.tryGet(e, WorkFlag);
    // A work flag alone qualifies: the AI pins a collector to its flag before the job settles, and a
    // flagged settler that no longer holds a harvest trade is itself a stall worth seeing.
    const holdsGathererTrade = settler.jobType !== null && harvestJobs.has(settler.jobType);
    if (flag === undefined && !holdsGathererTrade) continue;
    out.push({
      entity: e,
      player: sim.world.get(e, Owner).player,
      jobType: settler.jobType,
      goodType: flag?.goodType ?? sim.world.tryGet(e, GatherSelection)?.goodType ?? null,
      flagged: flag !== undefined,
      productive: sim.world.tryGet(e, CurrentAtomic)?.effect.kind === 'harvest' || sim.world.has(e, Carrying),
      stranded: sim.world.has(e, Stranded),
    });
  }
  return out;
}

/**
 * The per-stall evidence probe: for one stalled collector, how much of its good stands within the
 * radius its own harvest scan measures (integer Manhattan) versus within the world-metric circle the
 * AI's "patch ran dry, move the flag" check measures — plus the nearest live node of that good. A
 * non-zero circle count against a zero Manhattan count is the AI-vs-gatherer metric mismatch; both
 * zero with a distant nearest node means the flag simply was not moved.
 *
 * Counts are measured from each node's ANCHOR (not its resolved work cell), which is what the AI's
 * probe uses; the gatherer's own scan measures the work cell, up to the content's work offset away.
 */
interface StallProbe {
  readonly flagRadius: number;
  /** Live nodes of the good inside the gatherer's own integer-Manhattan work radius. */
  readonly inManhattan: number;
  /** Live nodes inside the world-metric circle the AI's dry-patch check measures. */
  readonly inWorldCircle: number;
  readonly nearestManhattan: number | null;
}

function probeStall(sim: Simulation, gatherer: Entity, goodType: number): StallProbe | null {
  const flag = sim.world.tryGet(gatherer, WorkFlag);
  if (flag === undefined) return null;
  const flagPos = sim.world.tryGet(flag.flag, Position);
  if (flagPos === undefined) return null;
  const at = nodeOfPosition(flagPos.x, flagPos.y);
  let inManhattan = 0;
  let inWorldCircle = 0;
  let nearestManhattan: number | null = null;
  for (const e of sim.world.query(Resource, Position)) {
    const res = sim.world.get(e, Resource);
    if (res.goodType !== goodType || res.remaining <= 0) continue;
    const p = sim.world.get(e, Position);
    const node = nodeOfPosition(p.x, p.y);
    const manhattan = Math.abs(node.hx - at.hx) + Math.abs(node.hy - at.hy);
    if (nearestManhattan === null || manhattan < nearestManhattan) nearestManhattan = manhattan;
    if (manhattan <= flag.radius) inManhattan++;
    if (systems.withinNodeRadius(at.hx, at.hy, node.hx, node.hy, flag.radius)) inWorldCircle++;
  }
  return { flagRadius: flag.radius, inManhattan, inWorldCircle, nearestManhattan };
}

describe.runIf(hasRealIr() && existsSync(realMapPath(mapId())))('gatherer idle-loop soak', () => {
  it('reports every collector that stopped collecting', { timeout: SOAK_TIMEOUT_MS }, async () => {
    const ticks = intEnv('ON_SOAK_TICKS', DEFAULT_TICKS, 1);
    const sampleEveryTicks = intEnv('ON_SOAK_SAMPLE_EVERY', DEFAULT_SAMPLE_EVERY_TICKS, 1);
    const stallTicks = intEnv('ON_SOAK_STALL_TICKS', DEFAULT_STALL_TICKS, 1);

    const { sim } = await realMapWorld({
      mapId: mapId(),
      aiSeats: AI_SEATS,
      fog: FOG_MODE.REVEAL,
      berryBushes: true,
    });
    const harvestJobs = harvestJobsOf(sim.content);
    expect(harvestJobs.size).toBeGreaterThan(0);

    const tracker = new StallTracker(stallTicks);
    for (let i = 0; i < ticks; i++) {
      sim.step();
      if (sim.tick % sampleEveryTicks === 0) tracker.observe(sim.tick, sampleGatherers(sim, harvestJobs));
    }
    const stalls = tracker.finish();

    const goodName = (goodType: number): string =>
      sim.content.goods.find((g) => g.typeId === goodType)?.id ?? `good_${goodType}`;
    const jobName = (jobType: number): string =>
      sim.content.jobs.find((j) => j.typeId === jobType)?.id ?? `job_${jobType}`;
    console.log(
      `\n${formatStallReport(
        { ticks, sampleEveryTicks, stallTicks, gatherersSeen: tracker.gatherersSeen, stalls },
        goodName,
        jobName,
      )}\n`,
    );
    // Probe the still-flagged stalled collectors. Iterating the live query (rather than the report)
    // is what keeps the branded `Entity` — the pure tracker knows entities only as plain numbers.
    const stalledByEntity = new Map(stalls.map((s) => [s.entity, s]));
    for (const e of sim.world.query(Settler, WorkFlag)) {
      const stall = stalledByEntity.get(e);
      if (stall === undefined || stall.goodType === null) continue;
      const probe = probeStall(sim, e, stall.goodType);
      if (probe === null) continue;
      console.log(
        `  settler ${stall.entity} (player ${stall.player}, ${goodName(stall.goodType)}): flag radius ${probe.flagRadius}, ` +
          `${probe.inManhattan} node(s) within the gatherer's Manhattan radius, ${probe.inWorldCircle} within the AI's ` +
          `world-metric circle, nearest live node at Manhattan ${probe.nearestManhattan ?? 'none'}`,
      );
    }
    console.log('');

    // The soak must have observed a real world — an empty one would report a clean bill of health
    // it never earned.
    expect(tracker.gatherersSeen).toBeGreaterThan(0);
  });
});
