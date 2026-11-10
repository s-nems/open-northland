import type { TargetFlashTone } from '@open-northland/render';
import type { Command, Entity, WorldSnapshot } from '@open-northland/sim';
import { components, fx, ONE, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_SCOUT, JOB_SOLDIER } from '../../../../src/catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../../../src/game/rules.js';
import { sandboxContent } from '../../../../src/game/sandbox/index.js';
import type { Pickable } from '../../../../src/view/picking.js';
import { createAnsweredOrders } from '../../../../src/view/unit-controls/orders/answered.js';
import {
  createUnitOrderController,
  type UnitOrderDeps,
} from '../../../../src/view/unit-controls/orders/controller.js';
import { withPointHits } from '../../../support/point-hits.js';
import { rightClickSettlers } from '../../../support/right-click.js';
import { STILL_CAMERA } from '../../../support/still-camera.js';

/**
 * Right-clicking a claimable animal sends the selected scouts after it, and any wild animal the scouts
 * are not claiming the selected fighters; every other selected settler takes the usual ladder. With Shift the claim and the
 * strike wait behind each settler's current order.
 */

const { addPerson, Owner, Position } = components;

const WOODCUTTER = 1;
/** Any entity id stands in for the animal: the order controller only passes it on. */
const ANIMAL = 999 as Entity;

function settlerAt(sim: Simulation, jobType: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(2), y: fx.fromInt(4) });
  addPerson(sim.world, e, {
    tribe: PRIMARY_TRIBE,
    jobType,
    hunger: ONE,
    fatigue: ONE,
    piety: ONE,
    enjoyment: ONE,
  });
  sim.world.add(e, Owner, { player: HUMAN_PLAYER });
  return e;
}

function rightClick(
  sim: Simulation,
  settlers: readonly Entity[],
  {
    shiftKey = false,
    claimable = true,
    flashed = [],
  }: {
    readonly shiftKey?: boolean;
    readonly claimable?: boolean;
    readonly flashed?: [number, TargetFlashTone][];
  } = {},
): Command[] {
  const issued: Command[] = [];
  const snapshot = sim.snapshot();
  const animal: Pickable = { ref: ANIMAL, x: 0, y: 0, kind: 'settler' };
  const targets = withPointHits({
    owned: () => [],
    buildings: () => [],
    enemies: () => [],
    flags: () => [],
    signposts: () => [],
    chests: () => [],
    goods: () => [],
    resources: () => [],
    wildlife: () => [animal],
    claimableLivestock: () => (claimable ? [animal] : []),
    ownedSettlersIn: () => settlers.map((ref) => ({ ref, x: 0, y: 0 })),
  });
  const deps = {
    answered: createAnsweredOrders(),
    camera: STILL_CAMERA,
    selected: () => new Set<number>(settlers),
    targets,
    snapshot: (): WorldSnapshot => snapshot,
    content: sim.content,
    mapSize: { width: 16, height: 16 },
    toWorld: () => ({ x: 0, y: 0 }),
    enqueue: (command) => issued.push(command),
    selectOwnSettler: () => {},
    openActions: () => {},
    flashTarget: (entity, tone) => flashed.push([entity, tone]),
  } satisfies UnitOrderDeps;
  rightClickSettlers(createUnitOrderController(deps), deps, {
    clientX: 0,
    clientY: 0,
    shiftKey,
  } as MouseEvent);
  return issued;
}

describe('right-clicking a claimable animal', () => {
  it('sends the scouts after it and walks the rest there', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const scouts = [settlerAt(sim, JOB_SCOUT), settlerAt(sim, JOB_SCOUT)];
    const cutter = settlerAt(sim, WOODCUTTER);
    const issued = rightClick(sim, [...scouts, cutter]);
    expect(issued[0]).toEqual({
      kind: 'unitActionGroup',
      members: scouts.map((entity) => ({ entity })),
      action: { kind: 'claimAnimal', animal: ANIMAL },
    });
    expect(issued.slice(1).map((c) => c.kind)).toEqual(['moveUnit']);
  });

  it('flashes the animal once the scouts take the claim', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const flashed: [number, TargetFlashTone][] = [];
    rightClick(sim, [settlerAt(sim, JOB_SCOUT)], { flashed });
    expect(flashed).toEqual([[ANIMAL, 'order']]);
  });

  it('flashes nothing when no scout takes the claim', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const flashed: [number, TargetFlashTone][] = [];
    rightClick(sim, [settlerAt(sim, WOODCUTTER)], { flashed });
    expect(flashed).toEqual([]);
  });

  it("with Shift queues the claim behind the scout's current order, and a walk for the rest", () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const scout = settlerAt(sim, JOB_SCOUT);
    const cutter = settlerAt(sim, WOODCUTTER);
    expect(rightClick(sim, [scout], { shiftKey: true })).toEqual([
      { kind: 'claimAnimal', entity: scout, animal: ANIMAL, queued: true },
    ]);
    expect(rightClick(sim, [cutter], { shiftKey: true })).toEqual([
      expect.objectContaining({ kind: 'moveUnit', entity: cutter, queued: true }),
    ]);
  });
});

describe('right-clicking a wild animal', () => {
  it('sends the fighters to strike it, flashing it red, and walks the rest there', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const soldiers = [settlerAt(sim, JOB_SOLDIER), settlerAt(sim, JOB_SOLDIER)];
    const cutter = settlerAt(sim, WOODCUTTER);
    const flashed: [number, TargetFlashTone][] = [];
    const issued = rightClick(sim, [...soldiers, cutter], { claimable: false, flashed });
    expect(flashed).toEqual([[ANIMAL, 'attack']]);
    expect(issued[0]).toEqual({
      kind: 'attackUnitGroup',
      members: soldiers.map((entity) => ({ entity })),
      target: ANIMAL,
    });
    expect(issued.slice(1).map((c) => c.kind)).toEqual(['moveUnit']);
  });

  it("with Shift queues the strike behind each fighter's current order, and a walk for the rest", () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const soldier = settlerAt(sim, JOB_SOLDIER);
    const cutter = settlerAt(sim, WOODCUTTER);
    expect(rightClick(sim, [soldier, cutter], { claimable: false, shiftKey: true })).toEqual([
      { kind: 'attackUnit', entity: soldier, target: ANIMAL, queued: true },
      expect.objectContaining({ kind: 'moveUnit', entity: cutter, queued: true }),
    ]);
  });

  it('walks a selection without fighters there', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const cutter = settlerAt(sim, WOODCUTTER);
    expect(rightClick(sim, [cutter], { claimable: false }).map((c) => c.kind)).toEqual(['moveUnit']);
  });

  it('lets the scouts claim a claimable one and walks the fighters there instead of striking it', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const scout = settlerAt(sim, JOB_SCOUT);
    const soldier = settlerAt(sim, JOB_SOLDIER);
    expect(rightClick(sim, [scout, soldier]).map((c) => c.kind)).toEqual(['claimAnimal', 'moveUnit']);
  });

  it('sends the fighters to strike a claimable one no selected scout claims', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const soldier = settlerAt(sim, JOB_SOLDIER);
    expect(rightClick(sim, [soldier])).toEqual([{ kind: 'attackUnit', entity: soldier, target: ANIMAL }]);
  });
});
