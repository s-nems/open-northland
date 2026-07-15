import { type ContentSet, IR_VERSION, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Settler } from '../../src/components/index.js';
import { fx, ONE, Simulation } from '../../src/index.js';
import { housingCapacity, tribePopulation } from '../../src/systems/index.js';
import { ctxOf } from '../fixtures/context.js';

/**
 * The housing read model — `housingCapacity` (the sum of a tribe's built `home` buildings' `homeSize`,
 * the original `logichousetype` `logichomesize`: home level 00 → 1 ... level 04 → 5) and
 * `tribePopulation` (its living settler count). Together they are the ceiling-vs-count the
 * ReproductionSystem will gate births on. This is the sim's first consumer of the extracted `homeSize`
 * param; no behavior is added yet, just the read.
 */

const VIKING = 1;
const OTHER_TRIBE = 2;

// A content set with two home levels (capacities 2 and 4) plus a non-residence, so the helper must
// pick out `kind === 'home'` and read each one's `homeSize`. Only goods/jobs/buildings are required
// by parseContentSet; the rest default.
function housingContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [{ typeId: 0, id: 'idle' }],
    buildings: [
      // The headquarters — a storage kind, NOT a residence: contributes 0 to housing capacity.
      { typeId: 1, id: 'headquarters', kind: 'headquarters' },
      // home level 00 (logichomesize 1 → capacity 2 here) and a bigger one (homeSize 4).
      { typeId: 2, id: 'home_small', kind: 'home', homeSize: 2 },
      { typeId: 3, id: 'home_large', kind: 'home', homeSize: 4 },
    ],
  });
}

function placeBuilding(sim: Simulation, buildingType: number, tribe: number, built = ONE): void {
  const e = sim.world.create();
  sim.world.add(e, Building, { buildingType, tribe, built, level: 0 });
}

function spawnSettler(sim: Simulation, tribe: number): void {
  const e = sim.world.create();
  sim.world.add(e, Settler, {
    tribe,
    jobType: null,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
}

describe('housingCapacity', () => {
  it('is 0 for a tribe with no home buildings', () => {
    const sim = new Simulation({ seed: 1, content: housingContent() });
    placeBuilding(sim, 1, VIKING); // a non-residence headquarters
    expect(housingCapacity(sim.world, ctxOf(sim), VIKING)).toBe(0);
  });

  it('sums the homeSize of a tribe’s built home buildings', () => {
    const sim = new Simulation({ seed: 1, content: housingContent() });
    placeBuilding(sim, 2, VIKING); // home_small, homeSize 2
    placeBuilding(sim, 3, VIKING); // home_large, homeSize 4
    placeBuilding(sim, 1, VIKING); // headquarters — not a residence, contributes 0
    expect(housingCapacity(sim.world, ctxOf(sim), VIKING)).toBe(6);
  });

  it('counts a residence only once it is built (built >= ONE)', () => {
    const sim = new Simulation({ seed: 1, content: housingContent() });
    placeBuilding(sim, 3, VIKING, fx.fromInt(0)); // under construction — shelters no one yet
    expect(housingCapacity(sim.world, ctxOf(sim), VIKING)).toBe(0);
    placeBuilding(sim, 3, VIKING, ONE); // built
    expect(housingCapacity(sim.world, ctxOf(sim), VIKING)).toBe(4);
  });

  it('is per-tribe — another tribe’s homes don’t count', () => {
    const sim = new Simulation({ seed: 1, content: housingContent() });
    placeBuilding(sim, 3, OTHER_TRIBE); // home_large for a different tribe
    placeBuilding(sim, 2, VIKING); // home_small for the viking
    expect(housingCapacity(sim.world, ctxOf(sim), VIKING)).toBe(2);
    expect(housingCapacity(sim.world, ctxOf(sim), OTHER_TRIBE)).toBe(4);
  });
});

describe('tribePopulation', () => {
  it('counts a tribe’s living settlers, regardless of job', () => {
    const sim = new Simulation({ seed: 1, content: housingContent() });
    spawnSettler(sim, VIKING);
    spawnSettler(sim, VIKING);
    spawnSettler(sim, OTHER_TRIBE);
    expect(tribePopulation(sim.world, VIKING)).toBe(2);
    expect(tribePopulation(sim.world, OTHER_TRIBE)).toBe(1);
    expect(tribePopulation(sim.world, 99)).toBe(0);
  });
});
