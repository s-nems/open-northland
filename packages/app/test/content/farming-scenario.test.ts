import type { BuildingType, ContentSet, GoodType, JobType, TribeType } from '@open-northland/data';
import { checkInvariants, components, fx, halfCellMapFromCells, ONE, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { TERRAIN_OPEN } from '../../src/catalog/terrain.js';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

/**
 * The field-farming loop (sow → water → grow → reap → bank) over the MERGED REAL content — the twin
 * of the sim fixture's end-to-end run (`packages/sim/test/economy/farming/coordination.cases.ts`),
 * with the wheat good, the farmer trade, the farm building, and the tribe all resolved from the
 * pipeline's output. The farm/farmer are built component-directly exactly like that proven sim e2e
 * (bound crew mid-life, not a construction saga); what real content contributes is the id joins and
 * the overlaid `farming` block — the pieces a fixture can never regress. Skips without content.
 */

const { Building, JobAssignment, Position, Settler, Stockpile } = components;

const SEED = 7;
const MAP_CELLS = 10;
/** Farm anchor in CELL coords (the fixture e2e's centre-of-map placement). */
const FARM_AT = { x: 5, y: 5 } as const;
/** Wheat farms at 500 ticks/stage × 5 stages on the clean-room balance (`catalog/farming.ts`), plus
 *  sow/water walking — 4000 ticks is comfortably past one full watered cycle. */
const FARM_TICKS = 4000;

function grassMap(cells: number) {
  return halfCellMapFromCells({
    width: cells,
    height: cells,
    typeIds: new Array(cells * cells).fill(TERRAIN_OPEN),
  });
}

/** Resolve wheat + the trade granted its plant atomic + a farm housing that trade + a playable tribe. */
function resolveActors(content: ContentSet): {
  wheat: GoodType;
  farmer: JobType;
  farm: BuildingType;
  tribe: TribeType;
} {
  const wheat = content.goods.find((g) => g.id === 'wheat');
  if (wheat?.farming === undefined || wheat.atomics.plant === undefined)
    throw new Error('real content ships no farmable wheat (no farming block or plant atomic)');
  const plant = wheat.atomics.plant;
  const farmer = [...content.jobs]
    .sort((a, b) => a.typeId - b.typeId)
    .find((j) => j.allowedAtomics.includes(plant) && !j.forbiddenAtomics.includes(plant));
  if (farmer === undefined) throw new Error('no trade is granted the wheat plant atomic');
  const farm = [...content.buildings]
    .sort((a, b) => a.typeId - b.typeId)
    .find(
      (b) =>
        b.workers.some((w) => w.jobType === farmer.typeId) &&
        b.stock.some((s) => s.goodType === wheat.typeId),
    );
  if (farm === undefined) throw new Error('no building staffs the farmer trade and stores wheat');
  const tribe = [...content.tribes]
    .sort((a, b) => a.typeId - b.typeId)
    .find((t) => t.jobEnables.length > 0 && t.hitpoints > 0);
  if (tribe === undefined) throw new Error('no playable tribe with hitpoints');
  return { wheat, farmer, farm, tribe };
}

/** Build the scenario: a completed farm with one bound farmer at the map centre (the sim e2e's shape). */
function buildScenario(content: ContentSet): { sim: Simulation; farmEntity: number } {
  const { farmer, farm, tribe } = resolveActors(content);
  const sim = new Simulation({ seed: SEED, content, map: grassMap(MAP_CELLS) });
  const farmEntity = sim.world.create();
  sim.world.add(farmEntity, Position, { x: fx.fromInt(FARM_AT.x), y: fx.fromInt(FARM_AT.y) });
  sim.world.add(farmEntity, Building, {
    buildingType: farm.typeId,
    tribe: tribe.typeId,
    built: ONE,
    level: 0,
  });
  sim.world.add(farmEntity, Stockpile, { amounts: new Map() });
  const farmerEntity = sim.world.create();
  sim.world.add(farmerEntity, Position, { x: fx.fromInt(FARM_AT.x), y: fx.fromInt(FARM_AT.y) });
  sim.world.add(farmerEntity, Settler, {
    tribe: tribe.typeId,
    jobType: farmer.typeId,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  sim.world.add(farmerEntity, JobAssignment, { workplace: farmEntity });
  return { sim, farmEntity };
}

describe.runIf(hasRealIr())('field-farming cycle over merged real content', () => {
  it('a bound farmer banks wheat in the real farm and holds the core invariants', async () => {
    const { merge } = await loadContentUnderTest();
    const { wheat } = resolveActors(merge.content);
    const { sim, farmEntity } = buildScenario(merge.content);
    for (let t = 0; t < FARM_TICKS; t++) {
      sim.step();
      const violations = checkInvariants(sim.world);
      expect(violations, `invariant broke at tick ${t + 1}`).toEqual([]);
    }
    const banked = sim.world.get(farmEntity, Stockpile).amounts.get(wheat.typeId) ?? 0;
    expect(banked, 'no wheat ever reached the farm store — the field loop stalled').toBeGreaterThan(0);
  });

  it('is deterministic on real content: two same-seed farm runs end byte-identical', async () => {
    const { merge } = await loadContentUnderTest();
    const a = buildScenario(merge.content).sim;
    const b = buildScenario(merge.content).sim;
    for (let t = 0; t < FARM_TICKS; t++) {
      a.step();
      b.step();
    }
    expect(a.hashState()).toBe(b.hashState());
  });
});
