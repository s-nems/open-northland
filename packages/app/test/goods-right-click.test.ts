import type { Command, Entity, WorldSnapshot } from '@open-northland/sim';
import { components, fx, ONE, Simulation, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_COLLECTOR, JOB_SOLDIER_SWORD } from '../src/catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../src/game/rules.js';
import {
  GOOD_MEAD,
  GOOD_SHOES,
  GOOD_SWORD_SHORT,
  GOOD_WOOD,
  sandboxContent,
} from '../src/game/sandbox/index.js';
import type { Pickable } from '../src/view/picking.js';
import { createUnitOrderController, type UnitOrderDeps } from '../src/view/unit-controls/orders.js';
import type { UnitTargets } from '../src/view/unit-controls/unit-targets.js';

/**
 * Right-clicking a good lying on the ground with settlers selected sends each one that may wear it to
 * put it on - the original's default interaction over a good's landscape object. A settler already
 * wearing that item, or one whose trade may not wear it, is left out; with nobody eligible, or over a
 * good nobody wears, the click is a walk.
 */

const { addPerson, Equipment, Owner, Position } = components;

function settlerAt(
  sim: Simulation,
  jobType: number,
  equipment: Partial<typeof Equipment.__value> = {},
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(2), y: fx.fromInt(4) });
  addPerson(sim.world, e, {
    tribe: PRIMARY_TRIBE,
    jobType,
    hunger: ONE,
    fatigue: ONE,
    piety: ONE,
    enjoyment: ONE,
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Owner, { player: HUMAN_PLAYER });
  sim.world.add(e, Equipment, {
    boots: null,
    tool: null,
    weapon: null,
    armor: null,
    misc: [null, null, null, null],
    ...equipment,
  });
  return e;
}

function rightClick(
  sim: Simulation,
  settlers: readonly Entity[],
  pile: Pickable,
  withPickList = true,
): Command[] {
  const pickList: UnitOrderDeps['equipPickList'] = withPickList
    ? (entity, group) => sim.equipPickList(entity as Entity, group)
    : undefined;
  const issued: Command[] = [];
  const snapshot = sim.snapshot();
  const targets: UnitTargets = {
    owned: () => [],
    enemies: () => [],
    flags: () => [],
    signposts: () => [],
    chests: () => [],
    goods: () => [pile],
    resources: () => [],
    wildlife: () => [],
    ownedSettlersIn: () => settlers.map((ref) => ({ ref, x: 0, y: 0 })),
  };
  createUnitOrderController({
    equipPickList: pickList,
    selected: () => new Set<number>(settlers),
    targets,
    snapshot: (): WorldSnapshot => snapshot,
    content: sim.content,
    mapSize: { width: 16, height: 16 },
    toWorld: () => ({ x: 0, y: 0 }),
    enqueue: (command) => issued.push(command),
    selectOwnSettler: () => {},
    openActions: () => {},
  }).issueRightClick({ clientX: 0, clientY: 0 } as MouseEvent);
  return issued;
}

/** A heap of `goodType` under the cursor, laid on the ground so the sim's pick list can reach it. */
function heap(sim: Simulation, goodType: number, amount = 1): Pickable {
  const ref = systems.createGroundGoods(sim.world, { goodType, amount, x: 10, y: 10 });
  return { ref, x: 0, y: 0, kind: 'pile', goodType };
}

describe('right-clicking a good on the ground', () => {
  it('orders every selected settler that may wear it to put it on, skipping one already wearing it', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const shoes = heap(sim, GOOD_SHOES, 2);
    const collector = settlerAt(sim, JOB_COLLECTOR);
    const soldier = settlerAt(sim, JOB_SOLDIER_SWORD);
    const shod = settlerAt(sim, JOB_SOLDIER_SWORD, {
      boots: { goodType: GOOD_SHOES, degreeOfUse: fx.fromInt(0) },
    });
    expect(rightClick(sim, [collector, soldier, shod], shoes)).toEqual([
      { kind: 'equipGood', entity: collector, group: 'boots', slot: 0, goodType: GOOD_SHOES },
      { kind: 'equipGood', entity: soldier, group: 'boots', slot: 0, goodType: GOOD_SHOES },
    ]);
    expect(rightClick(sim, [shod], shoes).map((c) => c.kind)).toEqual(['moveUnit']);
  });

  it('a weapon goes only to fighters; a civilian in the selection walks nowhere', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const sword = heap(sim, GOOD_SWORD_SHORT);
    const collector = settlerAt(sim, JOB_COLLECTOR);
    const soldier = settlerAt(sim, JOB_SOLDIER_SWORD);
    expect(rightClick(sim, [collector, soldier], sword)).toEqual([
      { kind: 'equipGood', entity: soldier, group: 'weapon', slot: 0, goodType: GOOD_SWORD_SHORT },
    ]);
    expect(rightClick(sim, [collector], sword).map((c) => c.kind)).toEqual(['moveUnit']);
  });

  it('a misc good fills the first free slot even for a settler already carrying one', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const mead = heap(sim, GOOD_MEAD);
    const drinker = settlerAt(sim, JOB_COLLECTOR, {
      misc: [{ goodType: GOOD_MEAD, degreeOfUse: fx.fromInt(0) }, null, null, null],
    });
    expect(rightClick(sim, [drinker], mead)).toEqual([
      { kind: 'equipGood', entity: drinker, group: 'misc', slot: 1, goodType: GOOD_MEAD },
    ]);
  });

  it('a good nobody wears, or a session without the pick-list seam, is a walk', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const collector = settlerAt(sim, JOB_COLLECTOR);
    expect(rightClick(sim, [collector], heap(sim, GOOD_WOOD)).map((c) => c.kind)).toEqual(['moveUnit']);
    expect(rightClick(sim, [collector], heap(sim, GOOD_SHOES), false).map((c) => c.kind)).toEqual([
      'moveUnit',
    ]);
  });
});
