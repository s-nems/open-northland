import type { Command, Entity, WorldSnapshot } from '@open-northland/sim';
import { components, fx, ONE, Simulation, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../src/game/rules.js';
import { sandboxContent } from '../src/game/sandbox/index.js';
import type { Pickable } from '../src/view/picking.js';
import { createUnitOrderController } from '../src/view/unit-controls/orders.js';
import type { UnitTargets } from '../src/view/unit-controls/unit-targets.js';

/**
 * Right-clicking a chest with settlers selected sends each one that may open it - the original's default
 * interaction over a chest. A child and, for a magical chest, a plain trade are left out of the order
 * rather than sent to be refused.
 */

const { addPerson, Age, Owner, Position } = components;

const WOODCUTTER = 1;

function settlerAt(sim: Simulation, jobType: number | null, child = false): Entity {
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
  if (child) sim.world.add(e, Age, { ticks: 0 });
  return e;
}

function rightClick(sim: Simulation, settlers: readonly Entity[], chest: Entity): Command[] {
  const issued: Command[] = [];
  const snapshot = sim.snapshot();
  const pickable: Pickable = { ref: chest, x: 0, y: 0, kind: 'chest' };
  const targets: UnitTargets = {
    owned: () => [],
    enemies: () => [],
    flags: () => [],
    signposts: () => [],
    chests: () => [pickable],
    wildlife: () => [],
    ownedSettlersIn: () => settlers.map((ref) => ({ ref, x: 0, y: 0 })),
  };
  createUnitOrderController({
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

describe('right-clicking a chest', () => {
  it('orders every selected adult that may open it, and nobody else', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const wooden = systems.createChest(sim.world, sim.content, {
      kind: 'wooden',
      contents: 20,
      x: 10,
      y: 10,
    });
    const magical = systems.createChest(sim.world, sim.content, {
      kind: 'magical',
      contents: 20,
      x: 12,
      y: 10,
    });
    const cutter = settlerAt(sim, WOODCUTTER);
    const idle = settlerAt(sim, null);
    const child = settlerAt(sim, null, true);
    expect(rightClick(sim, [cutter, idle, child], wooden)).toEqual([
      { kind: 'openChest', entity: cutter, chest: wooden },
      { kind: 'openChest', entity: idle, chest: wooden },
    ]);
    expect(rightClick(sim, [cutter, idle, child], magical)).toEqual([]);
  });
});
