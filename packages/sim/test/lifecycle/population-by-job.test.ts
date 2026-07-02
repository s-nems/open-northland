import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { beforeEach, describe, expect, it } from 'vitest';
import { Settler } from '../../src/components/index.js';
import { Simulation, fx } from '../../src/index.js';
import { IDLE_JOB, tribePopulationByJob } from '../../src/systems/index.js';

/**
 * The jobs read model — `tribePopulationByJob` tallies a tribe's settlers by `jobType` (the third HUD
 * read view after `tribeStocks` + `tribePopulation`). It is a pure, deterministic derived view, no
 * mechanic added; determinism is covered by the addition-commutes argument (a count is
 * order-independent). These tests pin the tally: per-job counting, the `null`→`IDLE_JOB` idle key, the
 * age-class-vs-trade keys, per-tribe isolation, and the empty case.
 */

const VIKING = 1;
const OTHER_TRIBE = 2;

// A real age class (baby_female id 1, a non-working life stage) and two adult trades, so the keys span
// the age-class vs. trade split the HUD partitions on. parseContentSet needs goods/jobs/buildings; the
// view reads only Settler.tribe + Settler.jobType, so the job records here are nominal.
const BABY_FEMALE = 1;
const FARMER = 10;
const CARPENTER = 11;

function jobsContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: BABY_FEMALE, id: 'baby_female' },
      { typeId: FARMER, id: 'farmer' },
      { typeId: CARPENTER, id: 'carpenter' },
    ],
    buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
  });
}

beforeEach(() => {
  Settler.store.clear();
});

function spawnSettler(sim: Simulation, tribe: number, jobType: number | null): void {
  const e = sim.world.create();
  sim.world.add(e, Settler, {
    tribe,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
}

describe('tribePopulationByJob', () => {
  it('is empty for a tribe with no settlers', () => {
    const sim = new Simulation({ seed: 1, content: jobsContent() });
    expect([...tribePopulationByJob(sim.world, VIKING).entries()]).toEqual([]);
  });

  it('counts settlers per job type', () => {
    const sim = new Simulation({ seed: 1, content: jobsContent() });
    spawnSettler(sim, VIKING, FARMER);
    spawnSettler(sim, VIKING, FARMER);
    spawnSettler(sim, VIKING, CARPENTER);
    const byJob = tribePopulationByJob(sim.world, VIKING);
    expect(byJob.get(FARMER)).toBe(2);
    expect(byJob.get(CARPENTER)).toBe(1);
    expect(byJob.get(BABY_FEMALE)).toBeUndefined(); // a job held by no one is absent
  });

  it('tallies idle (null jobType) adults under the IDLE_JOB sentinel key', () => {
    const sim = new Simulation({ seed: 1, content: jobsContent() });
    spawnSettler(sim, VIKING, null); // an idle, job-seeking adult
    spawnSettler(sim, VIKING, null);
    spawnSettler(sim, VIKING, FARMER);
    const byJob = tribePopulationByJob(sim.world, VIKING);
    expect(byJob.get(IDLE_JOB)).toBe(2);
    expect(byJob.get(FARMER)).toBe(1);
    expect(IDLE_JOB).toBeLessThan(0); // a negative sentinel can't collide with a real (>=0) job id
  });

  it('keys age classes by their job id, distinct from adult trades', () => {
    const sim = new Simulation({ seed: 1, content: jobsContent() });
    spawnSettler(sim, VIKING, BABY_FEMALE); // a non-working age class (id 1)
    spawnSettler(sim, VIKING, BABY_FEMALE);
    spawnSettler(sim, VIKING, FARMER); // an adult trade
    const byJob = tribePopulationByJob(sim.world, VIKING);
    // The view tallies by key; a consumer partitions age-class keys (1-4) from trade keys itself.
    expect(byJob.get(BABY_FEMALE)).toBe(2);
    expect(byJob.get(FARMER)).toBe(1);
  });

  it('is per-tribe — another tribe’s settlers are not counted', () => {
    const sim = new Simulation({ seed: 1, content: jobsContent() });
    spawnSettler(sim, VIKING, FARMER);
    spawnSettler(sim, OTHER_TRIBE, FARMER);
    spawnSettler(sim, OTHER_TRIBE, CARPENTER);
    expect(tribePopulationByJob(sim.world, VIKING).get(FARMER)).toBe(1);
    expect(tribePopulationByJob(sim.world, OTHER_TRIBE).get(FARMER)).toBe(1);
    expect(tribePopulationByJob(sim.world, OTHER_TRIBE).get(CARPENTER)).toBe(1);
    expect([...tribePopulationByJob(sim.world, 99).entries()]).toEqual([]); // an absent tribe
  });
});
