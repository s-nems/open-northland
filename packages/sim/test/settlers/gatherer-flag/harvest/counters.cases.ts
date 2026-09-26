import type { ContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  CurrentAtomic,
  Owner,
  Position,
  ProductionCounters,
  productionCountOf,
  Resource,
  ResourceLayers,
} from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { fx, Simulation } from '../../../../src/index.js';
import {
  anchorOnlyFootprint,
  plannerSystem,
  setGatherGood,
  setProductionCount,
  setProductionGoods,
  stampResourceFootprintData,
} from '../../../../src/systems/index.js';
import { testContent } from '../../../fixtures/content.js';
import {
  bindToFlag,
  ctxOf,
  grassMap,
  makeWoodcutter,
  placeFellableTree,
  runTicks,
  WIDE_RADIUS,
  WOOD,
  WOODCUTTER,
} from '../support.js';

const STONE = 4;
const MUSHROOM = 5;
const PLANK = 2; // a workshop product no gathering trade harvests
const STONE_HARVEST = 25;
const MUSHROOM_HARVEST = 32;
/** Ticks for a gatherer to pick, carry and pile several one-unit mushrooms beside its flag. */
const SEVERAL_LOADS_TICKS = 1500;

/** The fixture woodcutter granted the stone and mushroom harvests too, so it gathers three goods. */
function threeGoodContent(): ContentSet {
  const base = testContent();
  return {
    ...base,
    jobs: base.jobs.map((job) =>
      job.typeId === WOODCUTTER
        ? { ...job, allowedAtomics: [...job.allowedAtomics, STONE_HARVEST, MUSHROOM_HARVEST] }
        : job,
    ),
  };
}

/** The three-good woodcutter as a trade whose production the player cannot set (`userCanChangeProductionFlag 0`). */
function fixedProductionContent(): ContentSet {
  const base = threeGoodContent();
  return {
    ...base,
    jobs: base.jobs.map((job) => (job.typeId === WOODCUTTER ? { ...job, changesProduction: false } : job)),
  };
}

function flagGatherer(sim: Simulation): Entity {
  const gatherer = makeWoodcutter(sim, 2, 0);
  sim.world.add(gatherer, Owner, { player: 0 });
  bindToFlag(sim, gatherer, 2, 0, WIDE_RADIUS);
  return gatherer;
}

function placeNode(
  sim: Simulation,
  x: number,
  goodType: number,
  harvestAtomic: number,
  remaining: number,
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(0) });
  sim.world.add(e, Resource, { goodType, remaining, harvestAtomic });
  stampResourceFootprintData(sim.world, e, anchorOnlyFootprint());
  return e;
}

function setCount(sim: Simulation, entity: Entity, goodType: number, count: number): void {
  setProductionCount(sim.world, ctxOf(sim), { kind: 'setProductionCount', entity, goodType, count });
}

function harvestTarget(sim: Simulation, gatherer: Entity): Entity | null {
  const effect = sim.world.tryGet(gatherer, CurrentAtomic)?.effect;
  return effect?.kind === 'harvest' ? effect.resource : null;
}

describe('flag-bound gatherer - production counters', () => {
  it('takes a good only while its counter is at least one', () => {
    const stopped = new Simulation({ seed: 4, content: threeGoodContent(), map: grassMap(8, 1) });
    const gatherer = flagGatherer(stopped);
    placeFellableTree(stopped, 2, 0); // the all-goods pick on this shared node
    const stone = placeNode(stopped, 2, STONE, STONE_HARVEST, 2);
    setCount(stopped, gatherer, WOOD, 0);
    plannerSystem(stopped.world, ctxOf(stopped));
    expect(harvestTarget(stopped, gatherer)).toBe(stone);

    const open = new Simulation({ seed: 4, content: threeGoodContent(), map: grassMap(8, 1) });
    const other = flagGatherer(open);
    const tree = placeFellableTree(open, 2, 0);
    placeNode(open, 2, STONE, STONE_HARVEST, 2);
    setCount(open, other, WOOD, 0);
    setCount(open, other, WOOD, 1);
    plannerSystem(open.world, ctxOf(open));
    expect(harvestTarget(open, other)).toBe(tree);
  });

  it('works a body through a stopped stage while a buried stage holds an open good', () => {
    const sim = new Simulation({ seed: 4, content: threeGoodContent(), map: grassMap(8, 1) });
    const gatherer = flagGatherer(sim);
    const body = placeNode(sim, 2, MUSHROOM, MUSHROOM_HARVEST, 1);
    sim.world.add(body, ResourceLayers, {
      layers: [{ goodType: STONE, amount: 1, harvestAtomic: STONE_HARVEST }],
    });
    setProductionGoods(sim.world, ctxOf(sim), {
      kind: 'setProductionGoods',
      entity: gatherer,
      goods: [STONE],
    });
    plannerSystem(sim.world, ctxOf(sim));
    expect(harvestTarget(sim, gatherer)).toBe(body);
  });

  it('spends a finite counter per landed unit and stands idle once every good is stopped', () => {
    const sim = new Simulation({ seed: 4, content: threeGoodContent(), map: grassMap(8, 1) });
    const gatherer = flagGatherer(sim);
    const mushrooms = [3, 4, 5].map((x) => placeNode(sim, x, MUSHROOM, MUSHROOM_HARVEST, 1));
    setProductionGoods(sim.world, ctxOf(sim), {
      kind: 'setProductionGoods',
      entity: gatherer,
      goods: [MUSHROOM],
    });
    setCount(sim, gatherer, MUSHROOM, 2);

    expect(runTicks(sim, SEVERAL_LOADS_TICKS)).toEqual([]);

    expect(mushrooms.filter((m) => sim.world.isAlive(m))).toHaveLength(1);
    expect(productionCountOf(sim.world.get(gatherer, ProductionCounters), MUSHROOM)).toBe(0);
    expect(harvestTarget(sim, gatherer)).toBeNull();
    expect(sim.workStatus(gatherer)).toEqual({ kind: 'nothingSelected' });
  });

  it('setGatherGood writes the canonical counters and null removes them', () => {
    const sim = new Simulation({ seed: 4, content: threeGoodContent(), map: grassMap(8, 1) });
    const gatherer = flagGatherer(sim);

    setGatherGood(sim.world, ctxOf(sim), { kind: 'setGatherGood', entity: gatherer, goodType: STONE });
    const held = sim.world.get(gatherer, ProductionCounters).counters.map(([good, count]) => [good, count]);
    expect(held).toEqual([
      [WOOD, 0],
      [MUSHROOM, 0],
    ]);
    setProductionGoods(sim.world, ctxOf(sim), {
      kind: 'setProductionGoods',
      entity: gatherer,
      goods: [STONE],
    });
    expect(
      sim.world.get(gatherer, ProductionCounters).counters.map(([good, count]) => [good, count]),
    ).toEqual(held);

    setGatherGood(sim.world, ctxOf(sim), { kind: 'setGatherGood', entity: gatherer, goodType: null });
    expect(sim.world.has(gatherer, ProductionCounters)).toBe(false);
    expect(sim.workStatus(gatherer)).toBeUndefined();
  });

  it('a trade whose production the player cannot set refuses the orders and gathers past stale counters', () => {
    const sim = new Simulation({ seed: 4, content: fixedProductionContent(), map: grassMap(8, 1) });
    const gatherer = flagGatherer(sim);
    const tree = placeFellableTree(sim, 2, 0);
    placeNode(sim, 2, STONE, STONE_HARVEST, 2);

    setCount(sim, gatherer, WOOD, 0);
    setGatherGood(sim.world, ctxOf(sim), { kind: 'setGatherGood', entity: gatherer, goodType: STONE });
    setProductionGoods(sim.world, ctxOf(sim), {
      kind: 'setProductionGoods',
      entity: gatherer,
      goods: [STONE],
    });
    expect(sim.world.has(gatherer, ProductionCounters)).toBe(false);

    // Counters an earlier trade left behind do not hold the person either.
    sim.world.add(gatherer, ProductionCounters, { counters: [[WOOD, 0]], cursor: 0 });
    plannerSystem(sim.world, ctxOf(sim));
    expect(harvestTarget(sim, gatherer)).toBe(tree);
  });

  it('setProductionCount accepts a good the trade harvests and refuses any other', () => {
    const sim = new Simulation({ seed: 4, content: threeGoodContent(), map: grassMap(8, 1) });
    const gatherer = flagGatherer(sim);

    setCount(sim, gatherer, PLANK, 3);
    expect(sim.world.has(gatherer, ProductionCounters)).toBe(false);

    setCount(sim, gatherer, STONE, 3);
    expect(productionCountOf(sim.world.get(gatherer, ProductionCounters), STONE)).toBe(3);
    expect(sim.workStatus(gatherer)).toBeUndefined();
  });
});
