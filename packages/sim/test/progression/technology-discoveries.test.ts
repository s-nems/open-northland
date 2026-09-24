import { parseContentSet } from '@open-northland/data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  discoverTechnology,
  noteSettlerProgress,
  Owner,
  Settler,
  setMapPermission,
  setSettlerJob,
  TechnologyDiscoveries,
  technologyDiscovered,
} from '../../src/components/index.js';
import * as contentIndexModule from '../../src/core/content-index.js';
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
/** The fixture smith, a trade the setup's tribe enables nothing from. */
const SMITH = 13;
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
    noteSettlerProgress(sim.world, worker);
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

  it('attributes every discovery notification to the worker who earned it', () => {
    const { sim, worker } = setup();
    const ctx = { ...ctxOf(sim), tick: 2 };
    technologySystem(sim.world, ctx);
    sim.events.clear();

    grantWorkExperience(sim.world, ctx, worker, WOOD, 3);
    technologySystem(sim.world, ctx);

    expect(sim.events.current().filter((event) => event.kind === 'technologyDiscovered')).toEqual([
      {
        kind: 'technologyDiscovered',
        entity: worker,
        player: PLAYER,
        tribe: TRIBE,
        technology: 'job',
        typeId: CARPENTER,
      },
      {
        kind: 'technologyDiscovered',
        entity: worker,
        player: PLAYER,
        tribe: TRIBE,
        technology: 'good',
        typeId: PLANK,
      },
      {
        kind: 'technologyDiscovered',
        entity: worker,
        player: PLAYER,
        tribe: TRIBE,
        technology: 'house',
        typeId: SMITHY,
      },
    ]);
  });

  it('attributes a house cascade to the qualifying worker when another settler also discovers in the tick', () => {
    const { sim, worker } = setup();
    const ctx = { ...ctxOf(sim), tick: 2 };
    technologySystem(sim.world, ctx);
    sim.events.clear();
    const other = settlerAt(sim, { tribe: TRIBE, jobType: 3 });
    sim.world.add(other, Owner, { player: PLAYER });

    grantWorkExperience(sim.world, ctx, worker, WOOD, 3);
    technologySystem(sim.world, ctx);

    expect(
      sim.events
        .current()
        .filter((event) => event.kind === 'technologyDiscovered' && event.technology === 'house'),
    ).toEqual([
      {
        kind: 'technologyDiscovered',
        entity: worker,
        player: PLAYER,
        tribe: TRIBE,
        technology: 'house',
        typeId: SMITHY,
      },
    ]);
  });

  it('attributes a permission-gated house to a qualified worker when permission arrives', () => {
    const { sim, worker } = setup();
    const ctx = { ...ctxOf(sim), tick: 2 };
    setMapPermission(sim.world, {
      player: PLAYER,
      tribe: TRIBE,
      kind: 'house',
      typeId: SMITHY,
      allowed: false,
    });
    technologySystem(sim.world, ctx);
    grantWorkExperience(sim.world, ctx, worker, WOOD, 3);
    technologySystem(sim.world, ctx);
    sim.events.clear();

    setMapPermission(sim.world, {
      player: PLAYER,
      tribe: TRIBE,
      kind: 'house',
      typeId: SMITHY,
      allowed: true,
    });
    technologySystem(sim.world, ctx);

    expect(sim.events.current().filter((event) => event.kind === 'technologyDiscovered')).toEqual([
      {
        kind: 'technologyDiscovered',
        entity: worker,
        player: PLAYER,
        tribe: TRIBE,
        technology: 'house',
        typeId: SMITHY,
      },
    ]);
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

describe('the sweep reads only settlers whose discovery input may have moved', () => {
  afterEach(() => vi.restoreAllMocks());

  /** The setup's worker among twenty more woodcutters of the same player. */
  function crowded() {
    const scene = setup();
    for (let i = 0; i < 20; i++) {
      const e = settlerAt(scene.sim, { tribe: TRIBE, jobType: WOODCUTTER });
      scene.sim.world.add(e, Owner, { player: PLAYER });
    }
    return scene;
  }

  it('reads no settler of an unchanged world, then the one worker who gained experience', () => {
    const { sim, worker, ctx } = crowded();
    technologySystem(sim.world, ctx);
    // Every read resolves the settler's tribe once, so an untouched world must resolve none.
    const lookups = vi.spyOn(contentIndexModule, 'contentIndex');
    technologySystem(sim.world, ctx);
    expect(lookups).not.toHaveBeenCalled();

    grantWorkExperience(sim.world, ctx, worker, WOOD, 3);
    technologySystem(sim.world, ctx);
    expect(jobEnabled(sim.world, ctx, PLAYER, TRIBE, CARPENTER)).toBe(true);
  });

  it('re-reads a settler whose owner changed', () => {
    const { sim, worker, ctx } = crowded();
    sim.world.remove(worker, Owner);
    grantWorkExperience(sim.world, ctx, worker, WOOD, 3);
    technologySystem(sim.world, ctx); // an ownerless worker discovers for nobody
    expect(jobEnabled(sim.world, ctx, PLAYER, TRIBE, CARPENTER)).toBe(false);

    sim.world.add(worker, Owner, { player: PLAYER });
    technologySystem(sim.world, ctx);
    expect(jobEnabled(sim.world, ctx, PLAYER, TRIBE, CARPENTER)).toBe(true);
  });

  it('re-reads a settler whose trade changed', () => {
    const { sim, worker, ctx } = crowded();
    grantWorkExperience(sim.world, ctx, worker, WOOD, 3);
    setSettlerJob(sim.world, worker, SMITH);
    technologySystem(sim.world, ctx); // no smith edge enables the carpenter
    expect(jobEnabled(sim.world, ctx, PLAYER, TRIBE, CARPENTER)).toBe(false);

    setSettlerJob(sim.world, worker, WOODCUTTER);
    technologySystem(sim.world, ctx);
    expect(jobEnabled(sim.world, ctx, PLAYER, TRIBE, CARPENTER)).toBe(true);
  });

  it('the cache verifier reports an input write that skipped the progress note', () => {
    const { sim, worker, ctx } = crowded();
    technologySystem(sim.world, ctx);
    expect(sim.world.verifyCaches()).toEqual([]);
    sim.world.mut(worker, Settler).experience.set(WOOD_TRACK, 1);
    expect(sim.world.verifyCaches()).toEqual([
      `technology: settler ${worker} changed its discovery input without a progress note`,
    ]);
    noteSettlerProgress(sim.world, worker);
    expect(sim.world.verifyCaches()).toEqual([]);
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

it('keeps the discovery lookup coherent across a cascade, an outside row write and a new world', () => {
  const sim = new Simulation({ seed: 1, content: testContent() });
  for (let typeId = 1; typeId <= 50; typeId++) discoverTechnology(sim.world, PLAYER, TRIBE, 'good', typeId);
  expect(technologyDiscovered(sim.world, PLAYER, TRIBE, 'good', 50)).toBe(true);
  expect(technologyDiscovered(sim.world, RIVAL, TRIBE, 'good', 50)).toBe(false);
  expect(sim.world.verifyCaches()).toEqual([]);

  // A row written behind the lookup's back, as a restore or a raw mut would, is still seen.
  const [carrier] = sim.world.query(TechnologyDiscoveries);
  if (carrier === undefined) throw new Error('the discoveries should have created their carrier');
  sim.world
    .mut(carrier, TechnologyDiscoveries)
    .rows.push({ player: RIVAL, tribe: TRIBE, kind: 'job', typeId: 7 });
  expect(technologyDiscovered(sim.world, RIVAL, TRIBE, 'job', 7)).toBe(true);
  expect(discoverTechnology(sim.world, RIVAL, TRIBE, 'job', 7)).toBe(false);
  expect(sim.world.verifyCaches()).toEqual([]);

  const restored = restoreSimulation(exportSaveGame(sim), { content: sim.content });
  expect(technologyDiscovered(restored.world, PLAYER, TRIBE, 'good', 50)).toBe(true);
  expect(technologyDiscovered(restored.world, RIVAL, TRIBE, 'job', 7)).toBe(true);
});
