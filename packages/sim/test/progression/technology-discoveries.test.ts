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
  rawXpForRepeats,
} from '../../src/systems/progression/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { settlerAt } from '../fixtures/settler.js';

const PLAYER = 0;
const RIVAL = 1;
const TRIBE = 1;
const WOODCUTTER = 1;
const CARPENTER = 2;
const PLANK = 2;
const SMITHY = 4;
/** The fixture's wood good, whose extraction feeds the wood track. */
const WOOD = 1;
const WOOD_TRACK = 1;

function setup(
  houseRequirements: { readonly jobs: readonly number[]; readonly goods: readonly number[] } = {
    jobs: [WOODCUTTER, CARPENTER],
    goods: [PLANK],
  },
) {
  const base = testContent();
  const content = parseContentSet({
    ...base,
    tribes: base.tribes.map((t) =>
      t.typeId !== TRIBE
        ? t
        : {
            ...t,
            technology: { houses: [{ house: SMITHY, ...houseRequirements }] },
            jobRequirements: [
              {
                requirement: 'need',
                target: 'job',
                targetId: CARPENTER,
                amount: 3,
                experienceTypes: [WOOD_TRACK],
              },
            ],
            jobEnables: [
              { jobType: WOODCUTTER, kind: 'job', targetId: CARPENTER },
              { jobType: CARPENTER, kind: 'good', targetId: PLANK },
            ],
          },
    ),
  });
  const sim = new Simulation({ seed: 5, content });
  const worker = settlerAt(sim, { tribe: TRIBE, jobType: WOODCUTTER });
  sim.world.add(worker, Owner, { player: PLAYER });
  return { sim, worker, ctx: ctxOf(sim) };
}

describe('player technology discoveries', () => {
  it('does not discover an authored current profession before that worker qualifies for it', () => {
    const { sim, worker, ctx } = setup({ jobs: [CARPENTER], goods: [] });
    setSettlerJob(sim.world, worker, CARPENTER);

    technologySystem(sim.world, ctx);
    expect(jobEnabled(sim.world, ctx, PLAYER, TRIBE, CARPENTER)).toBe(false);
    expect(buildingEnabled(sim.world, ctx, PLAYER, TRIBE, SMITHY)).toBe(false);

    const track = sim.content.jobExperience.find((candidate) => candidate.typeId === WOOD_TRACK);
    sim.world.mut(worker, Settler).experience.set(WOOD_TRACK, rawXpForRepeats(track, 3));
    technologySystem(sim.world, ctx);
    expect(jobEnabled(sim.world, ctx, PLAYER, TRIBE, CARPENTER)).toBe(true);
    expect(buildingEnabled(sim.world, ctx, PLAYER, TRIBE, SMITHY)).toBe(true);
  });

  it('work discovers a profession and its basic product, opening a house before that profession is staffed', () => {
    const { sim, worker, ctx } = setup();
    technologySystem(sim.world, ctx);
    expect(buildingEnabled(sim.world, ctx, PLAYER, TRIBE, SMITHY)).toBe(false);
    grantWorkExperience(sim.world, ctx, worker, WOOD, 2);
    technologySystem(sim.world, ctx);
    expect(jobEnabled(sim.world, ctx, PLAYER, TRIBE, CARPENTER)).toBe(false);
    grantWorkExperience(sim.world, ctx, worker, WOOD, 1);
    technologySystem(sim.world, ctx);
    expect(sim.world.get(worker, Settler).jobType).toBe(WOODCUTTER);
    expect(jobEnabled(sim.world, ctx, PLAYER, TRIBE, CARPENTER)).toBe(true);
    expect(goodEnabled(sim.world, ctx, PLAYER, TRIBE, PLANK)).toBe(true);
    expect(buildingEnabled(sim.world, ctx, PLAYER, TRIBE, SMITHY)).toBe(true);
    expect(buildingEnabled(sim.world, ctx, RIVAL, TRIBE, SMITHY)).toBe(false);
  });

  it('discoveries survive retraining, death and save restoration', () => {
    const { sim, worker, ctx } = setup();
    grantWorkExperience(sim.world, ctx, worker, WOOD, 3);
    technologySystem(sim.world, ctx);
    setSettlerJob(sim.world, worker, null);
    technologySystem(sim.world, ctx);
    sim.world.destroy(worker);
    expect(buildingEnabled(sim.world, ctx, PLAYER, TRIBE, SMITHY)).toBe(true);
    const restored = restoreSimulation(exportSaveGame(sim), { content: sim.content });
    expect(buildingEnabled(restored.world, ctxOf(restored), PLAYER, TRIBE, SMITHY)).toBe(true);
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
  const restored = restoreSimulation(exportSaveGame(sim), { content: sim.content });
  sim.run(3);
  restored.run(3);
  expect(restored.hashState()).toBe(sim.hashState());
  for (const entity of sim.world.query(TechnologyDiscoveries)) {
    const rows = sim.world.get(entity, TechnologyDiscoveries).rows;
    expect(new Set(rows.map((row) => JSON.stringify(row))).size).toBe(rows.length);
  }
});
