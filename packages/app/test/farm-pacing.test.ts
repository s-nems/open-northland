import { components, type Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../src/catalog/buildings.js';
import { FARM_MAX_FIELDS } from '../src/catalog/farming.js';
import {
  BUILDING_FARM,
  BUILDING_WAREHOUSE_00,
  GOOD_WHEAT,
  JOB_COLLECTOR,
  placeSandboxBuilding,
  spawnSandboxSettler,
  spawnWorkersAtDoor,
} from '../src/game/sandbox/index.js';
import { createSceneSim } from '../src/scenes/runtime.js';

/**
 * Farm PACING over the shipped clean-room balance (`catalog/farming.ts`) — the shape measured in the
 * running original, which the field loop is calibrated to:
 *
 *  - throughput is LINEAR in the crew (~10 grain per farmer per 10 minutes), because every growth stage
 *    costs a watering, so a grain costs farmer labor rather than wall-clock time,
 *  - the plot holds ~20–25 standing plants for ANY crew size — its size is the FARM's, not the crew's,
 *  - and it ripens continuously, never emptying into one mass harvest (the per-field growth spread).
 *
 * This measures an IDEALIZED farm: flat grass, an always-hungry sink, no hunger or sleep. It runs ~20%
 * above the original's rate for that reason, so the bands below pin the SHAPE — linearity, plot size,
 * continuity — not an exact grain count. A change that breaks the shape (a growth gate, a priority swap,
 * a crew-scaled plot) fails here; a 20% tuning drift deliberately does not.
 */

const { Building, Crop, Stockpile } = components;

/** 10 minutes of game time at the sim's 12 ticks/s — the window the original was measured over. */
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
  /** Mean standing plants across the window. */
  readonly meanFields: number;
  /** Most standing plants at once. */
  readonly peakFields: number;
  /** Share of the window with at least 20 plants standing, as a percentage. */
  readonly pctFull: number;
  /** Most distinct growth stages standing at once. */
  readonly stagesAtOnce: number;
}

function measure(farmers: number): Measured {
  const sim = createSceneSim({
    seed: 15,
    terrain: grassTerrain(MAP, MAP),
    build: (s: Simulation) => {
      spawnSandboxSettler(s, JOB_COLLECTOR, ENABLER.x, ENABLER.y);
      placeSandboxBuilding(s, BUILDING_FARM, FARM.x, FARM.y);
      placeSandboxBuilding(s, BUILDING_WAREHOUSE_00, WAREHOUSE.x, WAREHOUSE.y);
      spawnWorkersAtDoor(s, BUILDING_FARM, FARM.x, FARM.y, farmers);
    },
  });

  // Empty every building store each tick — a stand-in for the mill and granary a real settlement feeds.
  // Without it the farm's own wheat slot fills and the store-full pause throttles what we are measuring.
  // Ground piles are left alone: those are loads in transit, not delivered output.
  let grain = 0;
  const drainStores = (): void => {
    for (const e of sim.world.query(Stockpile)) {
      if (!sim.world.has(e, Building)) continue;
      const store = sim.world.get(e, Stockpile);
      grain += store.amounts.get(GOOD_WHEAT) ?? 0;
      store.amounts.delete(GOOD_WHEAT);
    }
  };

  for (let t = 0; t < WARMUP_TICKS; t++) {
    sim.step();
    drainStores();
  }
  grain = 0;

  let fieldSum = 0;
  let peakFields = 0;
  let fullTicks = 0;
  let stagesAtOnce = 0;
  for (let t = 0; t < TEN_MINUTES; t++) {
    sim.step();
    drainStores();
    let fields = 0;
    const stages = new Set<number>();
    for (const e of sim.world.query(Crop)) {
      fields++;
      stages.add(sim.world.get(e, Crop).stage);
    }
    fieldSum += fields;
    peakFields = Math.max(peakFields, fields);
    stagesAtOnce = Math.max(stagesAtOnce, stages.size);
    if (fields >= 20) fullTicks++;
  }
  return {
    grain,
    meanFields: fieldSum / TEN_MINUTES,
    peakFields,
    pctFull: (100 * fullTicks) / TEN_MINUTES,
    stagesAtOnce,
  };
}

describe('farm pacing against the original', () => {
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

  it('every farmer adds its own ~10 grain per 10 minutes — throughput is the crew, not a timer', () => {
    for (const crew of CREWS) {
      expect(rateOf(crew), `${crew} farmer(s)`).toBeGreaterThanOrEqual(8);
      expect(rateOf(crew), `${crew} farmer(s)`).toBeLessThanOrEqual(15);
    }
    // A full crew never collapses to a lone farmer's rate — the plot is not a growth-capped timer that
    // extra hands queue behind. The band is one-sided on purpose: a LONE farmer currently runs ~25% below
    // the per-farmer rate of crews 2-4 (it cannot re-water 24 fields inside a stage), so the ladder is
    // not the straight line the original measures. Calibrating that out is
    // docs/tickets/sim/lone-farmer-shortfall.md.
    expect(rateOf(4) / rateOf(1)).toBeGreaterThan(0.8);
  });

  it("the plot holds ~20-25 plants for ANY crew size — its size is the farm's, not the crew's", () => {
    for (const crew of CREWS) {
      const run = runOf(crew);
      expect(run.peakFields, `${crew} farmer(s)`).toBe(FARM_MAX_FIELDS);
      expect(run.meanFields, `${crew} farmer(s)`).toBeGreaterThan(20);
      expect(run.pctFull, `${crew} farmer(s)`).toBeGreaterThan(75);
    }
  });

  it('the plot ripens continuously: mixed stages standing, never stripped bare', () => {
    for (const crew of CREWS) {
      const run = runOf(crew);
      // The old lockstep loop emptied the plot to 0 on every harvest wave and refilled it as one cohort.
      expect(run.stagesAtOnce, `${crew} farmer(s)`).toBeGreaterThanOrEqual(3);
    }
  });
});
