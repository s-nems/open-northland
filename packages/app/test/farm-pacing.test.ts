import { components, type Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../src/catalog/buildings.js';
import { FARM_MAX_FIELDS } from '../src/catalog/farming.js';
import { JOB_COLLECTOR } from '../src/catalog/jobs.js';
import {
  BUILDING_FARM,
  BUILDING_WAREHOUSE_00,
  GOOD_WHEAT,
  placeBuiltSandboxBuilding,
  placeSandboxBuilding,
  spawnSandboxSettler,
  spawnWorkersAtDoor,
} from '../src/game/sandbox/index.js';
import { createSceneSim } from '../src/scenes/runtime.js';

/**
 * Farm PACING over the shipped balance (`catalog/farming.ts`), against the shape measured in the running
 * original:
 *
 *  - throughput follows the crew, because every growth stage costs a watering and every grain a sowing, a
 *    reaping and a carry, so a grain costs farmer labor rather than wall-clock time,
 *  - the plot holds ~20-25 standing plants for ANY crew size - its size is the FARM's, not the crew's,
 *  - and it ripens continuously, never emptying into one mass harvest: the can serves the least-grown
 *    field and reaches its ring, so the plot keeps a spread of heights.
 *
 * This measures an IDEALIZED farm: flat grass, an always-hungry sink, no hunger or sleep. It runs about
 * 33-37 grain per farmer per 10 minutes, three times the original's observed ~10, a gap the shipped balance
 * cannot close without a limiter the data does not name. The bands below therefore pin the SHAPE - plot
 * size, continuity, the per-farmer rate holding as the crew grows, a lone farmer's cold start - not the
 * observed grain count. A change that breaks the shape (a growth gate, a priority swap, a crew-scaled
 * plot, a sow that dithers) fails here; a tuning drift deliberately does not.
 */

const { Building, Crop, Stockpile } = components;

/** 10 minutes of game time at the sim's 12 ticks/s - the window the original was measured over. */
const TEN_MINUTES = 10 * 60 * 12;
/** Ticks the farm spends ploughing and first-watering its plot; measurement starts after it. */
const WARMUP_TICKS = TEN_MINUTES;

const MAP = 60;
const FARM = { x: 28, y: 28 } as const;
/** Near the farm, so overflow hauling never becomes the bottleneck under test. */
const WAREHOUSE = { x: 40, y: 28 } as const;
/** Clear of the plot: the farm is `jobEnablesHouse`-gated on a collector (scenes/chain.ts), which has
 *  nothing to gather here and simply idles. */
const ENABLER = { x: 2, y: 2 } as const;

interface Measured {
  /** Grain delivered to a store during the measured window. */
  readonly grain: number;
  /** Tick of the first grain delivered to a store, counted from the farm's first tick. */
  readonly firstGrainTick: number;
  /** Mean standing plants across the window. */
  readonly meanFields: number;
  /** Most standing plants at once. */
  readonly peakFields: number;
  /** Share of the window with at least 20 plants standing, as a percentage. */
  readonly pctFull: number;
  /** Most distinct growth stages standing at once. */
  readonly stagesAtOnce: number;
  /** Largest share of a full plot (20+ plants) found in one growth stage at any tick, 0..1. */
  readonly maxStageShare: number;
}

function measure(farmers: number): Measured {
  const sim = createSceneSim({
    seed: 15,
    terrain: grassTerrain(MAP, MAP),
    build: (s: Simulation) => {
      spawnSandboxSettler(s, JOB_COLLECTOR, ENABLER.x, ENABLER.y);
      const farm = placeBuiltSandboxBuilding(s, BUILDING_FARM, FARM.x, FARM.y);
      placeSandboxBuilding(s, BUILDING_WAREHOUSE_00, WAREHOUSE.x, WAREHOUSE.y);
      spawnWorkersAtDoor(s, farm, farmers);
    },
  });

  // Empty every building store each tick - a stand-in for the mill and granary a real settlement feeds.
  // Without it the farm's own wheat slot fills and the store-full pause throttles what we are measuring.
  // Ground piles are left alone: those are loads in transit, not delivered output.
  let grain = 0;
  let firstGrainTick = Number.POSITIVE_INFINITY;
  const drainStores = (tick: number): void => {
    for (const e of sim.world.query(Stockpile)) {
      if (!sim.world.has(e, Building)) continue;
      const store = sim.world.mut(e, Stockpile);
      const delivered = store.amounts.get(GOOD_WHEAT) ?? 0;
      if (delivered > 0) firstGrainTick = Math.min(firstGrainTick, tick);
      grain += delivered;
      store.amounts.delete(GOOD_WHEAT);
    }
  };

  for (let t = 1; t <= WARMUP_TICKS; t++) {
    sim.step();
    drainStores(t);
  }
  grain = 0;

  let fieldSum = 0;
  let peakFields = 0;
  let fullTicks = 0;
  let stagesAtOnce = 0;
  let maxStageShare = 0;
  for (let t = 1; t <= TEN_MINUTES; t++) {
    sim.step();
    drainStores(WARMUP_TICKS + t);
    let fields = 0;
    const perStage = new Map<number, number>();
    for (const e of sim.world.query(Crop)) {
      fields++;
      const stage = sim.world.get(e, Crop).stage;
      perStage.set(stage, (perStage.get(stage) ?? 0) + 1);
    }
    fieldSum += fields;
    peakFields = Math.max(peakFields, fields);
    stagesAtOnce = Math.max(stagesAtOnce, perStage.size);
    if (fields >= 20) {
      fullTicks++;
      for (const count of perStage.values()) maxStageShare = Math.max(maxStageShare, count / fields);
    }
  }
  return {
    grain,
    firstGrainTick,
    meanFields: fieldSum / TEN_MINUTES,
    peakFields,
    pctFull: (100 * fullTicks) / TEN_MINUTES,
    stagesAtOnce,
    maxStageShare,
  };
}

/** Grain per farmer per 10 minutes every crew clears: near the ~10 the original shows, so a limiter that
 *  closes the idealized farm's gap still passes, while a broken loop yields about none. */
const RATE_FLOOR = 8;
/** Grain per farmer per 10 minutes no crew exceeds, over the measured 33-37: a loop that stops charging
 *  labor somewhere (a free watering, a skipped carry) lands above it. */
const RATE_CEILING = 45;
/** The per-farmer rate a crew of four keeps relative to a lone farmer's; measured ~0.95, since the plot
 *  cap and the shared paths cost a full crew a little. */
const CREW_RATE_HOLD = 0.75;
/** Ticks a lone farmer may take to bank its first grain. Keeping fields outside the finished farm's
 *  reserved ground puts the seeded run near tick 3200; this leaves room for path choice without hiding
 *  a stalled plot. */
const LONE_FIRST_GRAIN_TICKS = 3600;
/** The share of a full plot one stage may hold at any tick: 0.50-0.63 at the peak of a wave across crews
 *  and seeds. */
const MAX_STAGE_SHARE = 0.7;

/** Whichever test runs first pays for all four memoized 14 400-tick runs, ~2 s on a quiet machine.
 *  A loaded full suite stretches that past vitest's 5 s default (13.4 s observed). The budget is a
 *  hang-guard sized ~30x the quiet run, not a benchmark. */
const PACING_RUN_TIMEOUT_MS = 60_000;

describe('farm pacing against the original', { timeout: PACING_RUN_TIMEOUT_MS }, () => {
  const CREWS = [1, 2, 3, 4];
  // Memoized on first use, never at collection time: each crew is a 14 400-tick simulation, so running
  // them in the describe body would put every one behind an unnamed collection error rather than the
  // failing test, put them outside per-test timeouts, and run all four even for a single filtered test.
  const runs = new Map<number, Measured>();
  const runOf = (crew: number): Measured => {
    const cached = runs.get(crew);
    if (cached !== undefined) return cached;
    const measured = measure(crew);
    runs.set(crew, measured);
    return measured;
  };
  const rateOf = (crew: number): number => runOf(crew).grain / crew;

  it('throughput follows the crew: every added farmer adds grain and the per-farmer rate holds', () => {
    for (const crew of CREWS) {
      expect(rateOf(crew), `${crew} farmer(s)`).toBeGreaterThanOrEqual(RATE_FLOOR);
      expect(rateOf(crew), `${crew} farmer(s)`).toBeLessThanOrEqual(RATE_CEILING);
      expect(rateOf(crew), `${crew} farmer(s)`).toBeGreaterThanOrEqual(rateOf(1) * CREW_RATE_HOLD);
    }
    for (const crew of CREWS.slice(1)) {
      expect(runOf(crew).grain, `${crew} farmer(s)`).toBeGreaterThan(runOf(crew - 1).grain);
    }
  });

  it('a lone farmer banks its first grain within the cold-start budget', () => {
    // The whole plot is ploughed and levelled before anything ripens, so the first sheaf is late but
    // bounded; a sow that dithers between spots or a can that serves one field at a time blows this.
    expect(runOf(1).firstGrainTick).toBeLessThanOrEqual(LONE_FIRST_GRAIN_TICKS);
  });

  it("the plot holds ~20-25 plants for ANY crew size - its size is the farm's, not the crew's", () => {
    for (const crew of CREWS) {
      const run = runOf(crew);
      expect(run.peakFields, `${crew} farmer(s)`).toBe(FARM_MAX_FIELDS);
      expect(run.meanFields, `${crew} farmer(s)`).toBeGreaterThan(20);
      expect(run.pctFull, `${crew} farmer(s)`).toBeGreaterThan(75);
    }
  });

  it('the plot ripens continuously: mixed stages standing, never one cohort', () => {
    for (const crew of CREWS) {
      const run = runOf(crew);
      // A lockstep loop empties the plot on every harvest wave and refills it as one cohort; a can that
      // waters nearest-first ripens one corner while the rest stands at its sown stage.
      expect(run.stagesAtOnce, `${crew} farmer(s)`).toBeGreaterThanOrEqual(3);
      expect(run.maxStageShare, `${crew} farmer(s)`).toBeLessThan(MAX_STAGE_SHARE);
    }
  });
});
