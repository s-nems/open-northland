import type { Command, Entity, WorldSnapshot } from '@open-northland/sim';
import { components, fx, ONE, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_SCOUT } from '../src/catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../src/game/rules.js';
import { sandboxContent } from '../src/game/sandbox/index.js';
import type { Pickable } from '../src/view/picking.js';
import { createAnsweredOrders } from '../src/view/unit-controls/answered-orders.js';
import { createUnitOrderController } from '../src/view/unit-controls/orders.js';
import type { UnitTargets } from '../src/view/unit-controls/unit-targets.js';

/**
 * Right-clicking a claimable animal sends the selected scouts after it; every other selected settler takes
 * the usual ladder. With Shift the claim waits behind each scout's current order.
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

function rightClick(sim: Simulation, settlers: readonly Entity[], shiftKey = false): Command[] {
  const issued: Command[] = [];
  const snapshot = sim.snapshot();
  const animal: Pickable = { ref: ANIMAL, x: 0, y: 0, kind: 'settler' };
  const targets: UnitTargets = {
    owned: () => [],
    buildings: () => [],
    enemies: () => [],
    flags: () => [],
    signposts: () => [],
    chests: () => [],
    goods: () => [],
    resources: () => [],
    wildlife: () => [animal],
    claimableLivestock: () => [animal],
    ownedSettlersIn: () => settlers.map((ref) => ({ ref, x: 0, y: 0 })),
  };
  createUnitOrderController({
    answered: createAnsweredOrders(),
    selected: () => new Set<number>(settlers),
    targets,
    snapshot: (): WorldSnapshot => snapshot,
    content: sim.content,
    mapSize: { width: 16, height: 16 },
    toWorld: () => ({ x: 0, y: 0 }),
    enqueue: (command) => issued.push(command),
    selectOwnSettler: () => {},
    openActions: () => {},
  }).issueRightClick({ clientX: 0, clientY: 0, shiftKey } as MouseEvent);
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

  it("with Shift queues the claim behind the scout's current order, and a walk for the rest", () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const scout = settlerAt(sim, JOB_SCOUT);
    const cutter = settlerAt(sim, WOODCUTTER);
    expect(rightClick(sim, [scout], true)).toEqual([
      { kind: 'claimAnimal', entity: scout, animal: ANIMAL, queued: true },
    ]);
    expect(rightClick(sim, [cutter], true)).toEqual([
      expect.objectContaining({ kind: 'moveUnit', entity: cutter, queued: true }),
    ]);
  });
});
