import type { BuildingType, ContentSet, GoodType, JobType, TribeType } from '@open-northland/data';
import {
  cellAnchorNode,
  checkInvariants,
  components,
  type Entity,
  fx,
  halfCellMapFromCells,
  ONE,
  positionOfNode,
  Simulation,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { TERRAIN_BARREN, TERRAIN_OPEN } from '../../src/catalog/terrain.js';
import { doorNode } from '../../src/view/projections/building-points.js';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

/**
 * The field-farming loop (sow → water → reap → bank) over the MERGED REAL content - the twin
 * of the sim fixture's end-to-end run (`packages/sim/test/economy/farming/coordination.cases.ts`),
 * with each farmed good, its trade, its workplace, and the tribe all resolved from the pipeline's
 * output: wheat on the farm and herb on the herb hut, which the original farms the same way.
 * The workplace/worker are built component-directly like that proven sim e2e (bound crew mid-life, not
 * a construction saga), the worker standing on the door cell as a staffed crew does; what real content
 * contributes is the id joins, the extracted footprints and the overlaid `farming` block - the pieces a
 * fixture can never regress. Skips without content.
 */

const { addPerson, Building, Crop, JobAssignment, Position, Stockpile } = components;

const SEED = 7;
const MAP_CELLS = 10;
/** Workplace anchor in CELL coords (the fixture e2e's centre-of-map placement). */
const FARM_AT = { x: 5, y: 5 } as const;
/** A lone worker ploughs the whole 25-field plot and levels it with the can before anything ripens, so
 *  the first pile lands near tick 2300 on the shipped balance (`catalog/farming.ts`); the sown node set
 *  moves with the seeded draw, so this budget leaves room for that swing. */
const FARM_TICKS = 6_000;
/** Long past the first sow on grass (a few hundred ticks), so a barren run that sows nothing has waited
 *  for every rung the worker could take. */
const BARREN_TICKS = 1_500;

/** The two goods the clean-room farming block completes on real content. */
const FARMED_GOOD_IDS = ['wheat', 'herb'] as const;

function flatMap(cells: number, terrain: number) {
  return halfCellMapFromCells({
    width: cells,
    height: cells,
    typeIds: new Array(cells * cells).fill(terrain),
  });
}

/** Resolve a farmed good + the trade granted both its plant and harvest atomics + a workplace housing that
 *  trade and storing the good + a playable tribe. The harvest atomic tells the farmer (29) and the herb
 *  guy (31) apart, since both may sow (34). */
function resolveActors(
  content: ContentSet,
  goodId: string,
): {
  crop: GoodType;
  worker: JobType;
  workplace: BuildingType;
  tribe: TribeType;
} {
  const crop = content.goods.find((g) => g.id === goodId);
  if (crop?.farming === undefined || crop.atomics.plant === undefined || crop.atomics.harvest === undefined)
    throw new Error(`real content ships no farmable ${goodId} (no farming block or field atomics)`);
  const { plant, harvest } = crop.atomics;
  const worker = [...content.jobs]
    .sort((a, b) => a.typeId - b.typeId)
    .find(
      (j) =>
        j.allowedAtomics.includes(plant) &&
        j.allowedAtomics.includes(harvest) &&
        !j.forbiddenAtomics.includes(plant),
    );
  if (worker === undefined) throw new Error(`no trade is granted the ${goodId} plant and harvest atomics`);
  const workplace = [...content.buildings]
    .sort((a, b) => a.typeId - b.typeId)
    .find(
      (b) =>
        b.workers.some((w) => w.jobType === worker.typeId) && b.stock.some((s) => s.goodType === crop.typeId),
    );
  if (workplace === undefined) throw new Error(`no building staffs the ${goodId} trade and stores ${goodId}`);
  const tribe = [...content.tribes]
    .sort((a, b) => a.typeId - b.typeId)
    .find((t) => t.jobEnables.length > 0 && t.hitpoints > 0);
  if (tribe === undefined) throw new Error('no playable tribe with hitpoints');
  return { crop, worker, workplace, tribe };
}

/** Build the scenario: a completed workplace at the map centre (the sim e2e's shape) with one bound
 *  worker on its door cell, on a flat map of one terrain class. The worker must start on the door: the
 *  herb hut's extracted walls block every walk edge out of its anchor, where the farm's leave one open. */
function buildScenario(
  content: ContentSet,
  goodId: string,
  terrain: number = TERRAIN_OPEN,
): { sim: Simulation; workplaceEntity: Entity } {
  const { worker, workplace, tribe } = resolveActors(content, goodId);
  const sim = new Simulation({ seed: SEED, content, map: flatMap(MAP_CELLS, terrain) });
  const anchor = cellAnchorNode(FARM_AT.x, FARM_AT.y);
  const door = doorNode(workplace.footprint, anchor);
  const workplaceEntity = sim.world.create();
  sim.world.add(workplaceEntity, Position, positionOfNode(anchor.hx, anchor.hy));
  sim.world.add(workplaceEntity, Building, {
    buildingType: workplace.typeId,
    tribe: tribe.typeId,
    built: ONE,
    level: 0,
  });
  sim.world.add(workplaceEntity, Stockpile, { amounts: new Map() });
  const workerEntity = sim.world.create();
  sim.world.add(workerEntity, Position, positionOfNode(door.hx, door.hy));
  addPerson(sim.world, workerEntity, {
    tribe: tribe.typeId,
    jobType: worker.typeId,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  sim.world.add(workerEntity, JobAssignment, { workplace: workplaceEntity });
  return { sim, workplaceEntity };
}

function standingFields(sim: Simulation): number {
  let fields = 0;
  for (const _e of sim.world.query(Crop)) fields++;
  return fields;
}

describe.runIf(hasRealIr())('field-farming cycle over merged real content', () => {
  it('resolves distinct trades and workplaces for wheat and herb', async () => {
    const { merge } = await loadContentUnderTest();
    const wheat = resolveActors(merge.content, 'wheat');
    const herb = resolveActors(merge.content, 'herb');
    expect(herb.worker.typeId).not.toBe(wheat.worker.typeId);
    expect(herb.workplace.typeId).not.toBe(wheat.workplace.typeId);
  });

  for (const goodId of FARMED_GOOD_IDS) {
    it(`a bound worker banks ${goodId} in its real workplace and holds the core invariants`, async () => {
      const { merge } = await loadContentUnderTest();
      const { crop } = resolveActors(merge.content, goodId);
      const { sim, workplaceEntity } = buildScenario(merge.content, goodId);
      for (let t = 0; t < FARM_TICKS; t++) {
        sim.step();
        const violations = checkInvariants(sim.world, sim.content);
        expect(violations, `invariant broke at tick ${t + 1}`).toEqual([]);
      }
      const banked = sim.world.get(workplaceEntity, Stockpile).amounts.get(crop.typeId) ?? 0;
      expect(banked, `no ${goodId} ever reached the store - the field loop stalled`).toBeGreaterThan(0);
      // Past the 5 s default: {@link FARM_TICKS} steps, each re-checking every invariant over the world.
    }, 60_000);

    it(`sows no ${goodId} on ground without the biocanplanton flag`, async () => {
      const { merge } = await loadContentUnderTest();
      const { sim } = buildScenario(merge.content, goodId, TERRAIN_BARREN);
      for (let t = 0; t < BARREN_TICKS; t++) sim.step();
      expect(standingFields(sim)).toBe(0);
    }, 30_000);
  }

  it('is deterministic on real content: two same-seed farm runs end byte-identical', async () => {
    const { merge } = await loadContentUnderTest();
    const a = buildScenario(merge.content, 'wheat').sim;
    const b = buildScenario(merge.content, 'wheat').sim;
    for (let t = 0; t < FARM_TICKS; t++) {
      a.step();
      b.step();
    }
    expect(a.hashState()).toBe(b.hashState());
    // Past the 5 s default: two full {@link FARM_TICKS} runs stepped in lockstep.
  }, 60_000);
});
