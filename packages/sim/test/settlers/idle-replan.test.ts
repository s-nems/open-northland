import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DeliveryFlag,
  IdleStand,
  MoveGoal,
  NeedOrder,
  Owner,
  Position,
  Resource,
  WorkFlag,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { positionOfNode, Simulation } from '../../src/index.js';
import { anchorOnlyFootprint, stampResourceFootprintData } from '../../src/systems/index.js';
import * as ladder from '../../src/systems/settlers/drives/ladder.js';
import { IDLE_REPLAN_PERIOD_TICKS, idleReplanDue } from '../../src/systems/settlers/planner/idle-replan.js';
import { testContent } from '../fixtures/content.js';
import { settlerAt } from '../fixtures/settler.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * An adult whose ladder found it nothing to do re-plans only on its staggered idle re-plan ticks, while an
 * order addressed to it acts on the tick it applies.
 */

const VIKING = 1;
const P0 = 0;
const WOODCUTTER = 1; // harvest atomic 24
const WOOD = 1;
const CHOP = 24;
const FLAG_RADIUS = 4;
/** Long enough for several idle periods. */
const WATCH_TICKS = 4 * IDLE_REPLAN_PERIOD_TICKS;

afterEach(() => vi.restoreAllMocks());

function newSim(): Simulation {
  return new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(48, 32) });
}

function woodcutterAt(sim: Simulation, hx: number, hy: number): Entity {
  const e = settlerAt(sim, { jobType: WOODCUTTER, tribe: VIKING, position: positionOfNode(hx, hy) });
  sim.world.add(e, Owner, { player: P0 });
  return e;
}

function treeAt(sim: Simulation, hx: number, hy: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  sim.world.add(e, Resource, { goodType: WOOD, remaining: 3, harvestAtomic: CHOP });
  stampResourceFootprintData(sim.world, e, { walk: [], build: [], work: [...anchorOnlyFootprint().work] });
  return e;
}

/** The ticks on which `planAdult` ran for `e` while the sim steps `ticks` times. */
function plannedTicks(sim: Simulation, e: Entity, ticks: number): number[] {
  const spy = vi.spyOn(ladder, 'planAdult');
  const seen: number[] = [];
  for (let i = 0; i < ticks; i++) {
    const before = spy.mock.calls.filter((args) => args[1] === e).length;
    sim.step();
    if (spy.mock.calls.filter((args) => args[1] === e).length > before) seen.push(sim.tick);
  }
  return seen;
}

describe('idle re-plan cadence', () => {
  it('an idle settler re-plans on its due ticks only', () => {
    const sim = newSim();
    const idler = woodcutterAt(sim, 10, 10); // no tree anywhere
    sim.step();
    expect(sim.world.get(idler, IdleStand)).toEqual({ standing: true });

    const ticks = plannedTicks(sim, idler, WATCH_TICKS);
    expect(ticks.length).toBe(WATCH_TICKS / IDLE_REPLAN_PERIOD_TICKS);
    for (const tick of ticks) expect(idleReplanDue(tick, idler)).toBe(true);
  });

  it('an idle settler takes up new work on its next due tick', () => {
    const sim = newSim();
    const idler = woodcutterAt(sim, 10, 10);
    sim.step();
    treeAt(sim, 16, 10);

    let waited = 0;
    while (!sim.world.has(idler, MoveGoal)) {
      sim.step();
      waited++;
      expect(waited).toBeLessThanOrEqual(IDLE_REPLAN_PERIOD_TICKS);
    }
    expect(idleReplanDue(sim.tick, idler)).toBe(true);
    expect(sim.world.has(idler, IdleStand)).toBe(false);
  });

  it('an order addressed to an idle settler acts on the tick it applies', () => {
    const sim = newSim();
    const idler = woodcutterAt(sim, 10, 10);
    sim.step();
    while (idleReplanDue(sim.tick + 1, idler)) sim.step();

    const orderTick = sim.tick + 1; // not its due tick
    sim.enqueueSetup({ kind: 'orderNeed', entity: idler, need: 'enjoyment' });
    expect(plannedTicks(sim, idler, 1)).toEqual([orderTick]);
    expect(sim.world.has(idler, NeedOrder)).toBe(true);
  });

  it('a flag gatherer standing by an exhausted flag rescans its flag area on its due ticks only', () => {
    const sim = newSim();
    const gatherer = woodcutterAt(sim, 10, 10);
    const flag = sim.world.create();
    sim.world.add(flag, Position, positionOfNode(10, 10));
    sim.world.add(flag, DeliveryFlag, {});
    sim.world.add(gatherer, WorkFlag, { flag, radius: FLAG_RADIUS });
    sim.step();
    expect(sim.world.get(gatherer, IdleStand)).toEqual({ standing: false });

    const ticks = plannedTicks(sim, gatherer, WATCH_TICKS);
    expect(ticks.length).toBe(WATCH_TICKS / IDLE_REPLAN_PERIOD_TICKS);
  });
});
