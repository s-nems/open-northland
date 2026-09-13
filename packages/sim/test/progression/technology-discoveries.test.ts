import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  discoverTechnology,
  Owner,
  Settler,
  setSettlerJob,
  TechnologyDiscoveries,
  technologyDiscovered,
} from '../../src/components/index.js';
import { exportSaveGame, restoreSimulation, Simulation } from '../../src/index.js';
import { technologySystem } from '../../src/systems/progression/discoveries.js';
import {
  buildingEnabled,
  goodEnabled,
  grantWorkExperience,
  jobEnabled,
} from '../../src/systems/progression/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { settlerAt } from '../fixtures/settler.js';

function setup() {
  const base = testContent();
  const content = parseContentSet({
    ...base,
    tribes: base.tribes.map((t) =>
      t.typeId !== 1
        ? t
        : {
            ...t,
            technology: { houses: [{ house: 4, jobs: [1, 2], goods: [2] }] },
            jobRequirements: [
              { requirement: 'need', target: 'job', targetId: 2, amount: 3, experienceTypes: [1] },
            ],
            jobEnables: [
              { jobType: 1, kind: 'job', targetId: 2 },
              { jobType: 2, kind: 'good', targetId: 2 },
            ],
          },
    ),
  });
  const sim = new Simulation({ seed: 5, content });
  const worker = settlerAt(sim, { tribe: 1, jobType: 1 });
  sim.world.add(worker, Owner, { player: 0 });
  return { sim, worker, ctx: ctxOf(sim) };
}

describe('player technology discoveries', () => {
  it('work discovers a profession and its basic product, opening a house before that profession is staffed', () => {
    const { sim, worker, ctx } = setup();
    technologySystem(sim.world, ctx);
    expect(buildingEnabled(sim.world, ctx, 0, 1, 4)).toBe(false);
    grantWorkExperience(sim.world, ctx, worker, 1, 2);
    technologySystem(sim.world, ctx);
    expect(jobEnabled(sim.world, ctx, 0, 1, 2)).toBe(false);
    grantWorkExperience(sim.world, ctx, worker, 1, 1);
    technologySystem(sim.world, ctx);
    expect(sim.world.get(worker, Settler).jobType).toBe(1);
    expect(jobEnabled(sim.world, ctx, 0, 1, 2)).toBe(true);
    expect(goodEnabled(sim.world, ctx, 0, 1, 2)).toBe(true);
    expect(buildingEnabled(sim.world, ctx, 0, 1, 4)).toBe(true);
    expect(buildingEnabled(sim.world, ctx, 1, 1, 4)).toBe(false);
  });

  it('discoveries survive retraining, death and save restoration', () => {
    const { sim, worker, ctx } = setup();
    grantWorkExperience(sim.world, ctx, worker, 1, 3);
    technologySystem(sim.world, ctx);
    setSettlerJob(sim.world, worker, null);
    technologySystem(sim.world, ctx);
    sim.world.destroy(worker);
    expect(buildingEnabled(sim.world, ctx, 0, 1, 4)).toBe(true);
    const restored = restoreSimulation(exportSaveGame(sim), { content: sim.content }).sim;
    expect(buildingEnabled(restored.world, ctxOf(restored), 0, 1, 4)).toBe(true);
  });
});

it('the first discovery is immediately visible and duplicate writes do not change state', () => {
  const sim = new Simulation({ seed: 1, content: testContent() });
  expect(technologyDiscovered(sim.world, 0, 1, 'job', 2)).toBe(false);
  expect(discoverTechnology(sim.world, 0, 1, 'job', 2)).toBe(true);
  const hash = sim.hashState();
  expect(technologyDiscovered(sim.world, 0, 1, 'job', 2)).toBe(true);
  expect(discoverTechnology(sim.world, 0, 1, 'job', 2)).toBe(false);
  expect(sim.hashState()).toBe(hash);
});

it('fallback profession edges remain discovered after the enabling worker is lost', () => {
  const sim = new Simulation({ seed: 1, content: testContent() });
  const worker = settlerAt(sim, { tribe: 1, jobType: 2 });
  sim.world.add(worker, Owner, { player: 0 });
  sim.step();
  sim.world.destroy(worker);
  expect(buildingEnabled(sim.world, ctxOf(sim), 0, 1, 4)).toBe(true);
  const restored = restoreSimulation(exportSaveGame(sim), { content: sim.content }).sim;
  sim.run(3);
  restored.run(3);
  expect(restored.hashState()).toBe(sim.hashState());
  for (const entity of sim.world.query(TechnologyDiscoveries)) {
    const rows = sim.world.get(entity, TechnologyDiscoveries).rows;
    expect(new Set(rows.map((row) => JSON.stringify(row))).size).toBe(rows.length);
  }
});
