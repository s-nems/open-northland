import { describe, expect, it } from 'vitest';
import {
  addPerson,
  CurrentAtomic,
  DeferredOrder,
  ErectSignpostOrder,
  Felling,
  MoveGoal,
  Owner,
  PlayerOrder,
  Position,
  Resource,
  Settler,
  Signpost,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { cellAnchorNode, fx, Simulation } from '../../src/index.js';
import {
  anchorOnlyFootprint,
  BUILD_GUIDE_ATOMIC_ID,
  stampResourceFootprintData,
} from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * Orders honour non-interruptible atomics: a settler mid-swing or mid-meal finishes the atomic, the order
 * parks on {@link DeferredOrder}, and the deferredOrderSystem replays it the tick the atomic completes.
 * Latest-order-wins between parked orders is a named approximation, as is the unmarked-clip-defaults-to-
 * non-interruptible reading (see `isInterruptibleAtomic`). An interruptible clip still obeys at once.
 * Fixture: job 1 binds eat (10) -> `viking_eat` (no flag: non-interruptible) and sleep (8) ->
 * `viking_sleep` (marked interruptible, like the original's outdoor sleep).
 */

const VIKING = 1;
const WOODCUTTER = 1;
const CARPENTER = 2;
const SCOUT = 27; // fixture job 27 - allowatomic 43 only, like the original scout
const HUMAN_PLAYER = 0;
const EAT_ATOMIC = 10;
const SLEEP_ATOMIC = 8;
const HARVEST_ATOMIC = 24;
const WOOD = 1;
const EAT_TICKS = 5; // fixture `viking_eat` length
const SLEEP_TICKS = 6; // fixture `viking_sleep` length

function freshSim(width = 12, height = 4): Simulation {
  return new Simulation({ seed: 1, content: testContent(), map: grassMap(width, height) });
}

/** An owned viking settler of `jobType` at visual cell (x,y), needs at zero. */
function ownedSettler(sim: Simulation, x: number, y: number, jobType: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  sim.world.add(e, Owner, { player: HUMAN_PLAYER });
  return e;
}

/** Put `e` mid-atomic: `atomicId` resolves the clip (and so interruptibility); the effect is inert. */
function startAtomic(sim: Simulation, e: Entity, atomicId: number, duration: number): void {
  sim.world.add(e, CurrentAtomic, {
    atomicId,
    elapsed: 0,
    progress: fx.fromInt(0),
    duration,
    effect: { kind: 'idle' },
    targetEntity: null,
    targetTile: null,
  });
}

/** Enqueue a moveUnit toward visual cell (cx,cy). */
function orderMove(sim: Simulation, e: Entity, cx: number, cy: number): void {
  const n = cellAnchorNode(cx, cy);
  sim.enqueueSetup({ kind: 'moveUnit', entity: e, x: n.hx, y: n.hy });
}

describe('moveUnit during a non-interruptible atomic', () => {
  it('parks the order and lets the meal finish, then walks the same tick the atomic completes', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 3, 1, WOODCUTTER);
    startAtomic(sim, e, EAT_ATOMIC, EAT_TICKS);

    orderMove(sim, e, 8, 1);
    sim.step();

    // The half-eaten meal survives the order: same atomic, ticking on, no walk started.
    const atomic = sim.world.get(e, CurrentAtomic);
    expect(atomic.atomicId).toBe(EAT_ATOMIC);
    expect(atomic.elapsed).toBe(1); // advanced, not restarted
    expect(sim.world.has(e, MoveGoal)).toBe(false);
    expect(sim.world.has(e, PlayerOrder)).toBe(false);
    expect(sim.world.get(e, DeferredOrder).command.kind).toBe('moveUnit');

    // The tick the meal completes, the parked order applies - no idle gap for a drive to claim.
    sim.run(EAT_TICKS - 1);
    expect(sim.world.has(e, CurrentAtomic)).toBe(false);
    expect(sim.world.has(e, DeferredOrder)).toBe(false);
    expect(sim.world.has(e, MoveGoal)).toBe(true);
    expect(sim.world.has(e, PlayerOrder)).toBe(true);

    const startX = sim.world.get(e, Position).x;
    sim.run(20);
    expect(sim.world.get(e, Position).x).toBeGreaterThan(startX); // walked the ordered way
  });

  it('interrupts an interruptible atomic (sleep) immediately, with nothing parked', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 3, 1, WOODCUTTER);
    startAtomic(sim, e, SLEEP_ATOMIC, SLEEP_TICKS);

    orderMove(sim, e, 8, 1);
    sim.step();

    expect(sim.world.tryGet(e, CurrentAtomic)?.atomicId).not.toBe(SLEEP_ATOMIC);
    expect(sim.world.has(e, DeferredOrder)).toBe(false);
    expect(sim.world.has(e, MoveGoal)).toBe(true);
    expect(sim.world.has(e, PlayerOrder)).toBe(true);
  });
});

describe('setJob during a non-interruptible atomic', () => {
  it('parks the profession change until the atomic completes', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 3, 1, WOODCUTTER);
    startAtomic(sim, e, EAT_ATOMIC, EAT_TICKS);

    sim.enqueueSetup({ kind: 'setJob', entity: e, jobType: CARPENTER });
    sim.step();

    expect(sim.world.get(e, CurrentAtomic).atomicId).toBe(EAT_ATOMIC);
    expect(sim.world.get(e, Settler).jobType).toBe(WOODCUTTER); // still the old trade mid-meal
    expect(sim.world.get(e, DeferredOrder).command.kind).toBe('setJob');

    sim.run(EAT_TICKS - 1);
    expect(sim.world.has(e, CurrentAtomic)).toBe(false);
    expect(sim.world.has(e, DeferredOrder)).toBe(false);
    expect(sim.world.get(e, Settler).jobType).toBe(CARPENTER);
  });

  it('latest-order-wins: a newer parked order replaces an older one', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 3, 1, WOODCUTTER);
    startAtomic(sim, e, EAT_ATOMIC, EAT_TICKS);

    orderMove(sim, e, 8, 1);
    sim.step();
    sim.enqueueSetup({ kind: 'setJob', entity: e, jobType: CARPENTER });
    sim.step();
    expect(sim.world.get(e, DeferredOrder).command.kind).toBe('setJob');

    sim.run(EAT_TICKS - 2);
    // Only the newer order applied: the trade changed, the superseded walk never started.
    expect(sim.world.get(e, Settler).jobType).toBe(CARPENTER);
    expect(sim.world.has(e, MoveGoal)).toBe(false);
    expect(sim.world.has(e, PlayerOrder)).toBe(false);
    expect(sim.world.has(e, DeferredOrder)).toBe(false);
  });
});

describe('a parked order and the multi-swing harvest chain', () => {
  it('releases the harvester at the swing boundary instead of holding the order for the whole tree', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 3, 1, WOODCUTTER);
    const tree = sim.world.create();
    sim.world.add(tree, Position, { x: fx.fromInt(4), y: fx.fromInt(1) });
    sim.world.add(tree, Resource, { goodType: WOOD, remaining: 4, harvestAtomic: HARVEST_ATOMIC });
    stampResourceFootprintData(sim.world, tree, anchorOnlyFootprint());
    sim.world.add(tree, Felling, { chopsLeft: 5 }); // far from felled - an ungated chain would re-arm
    const swingTicks = 3; // fixture `viking_chop` length
    sim.world.add(e, CurrentAtomic, {
      atomicId: HARVEST_ATOMIC,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: swingTicks,
      effect: { kind: 'harvest', resource: tree, goodType: WOOD },
      targetEntity: tree,
      targetTile: null,
    });

    orderMove(sim, e, 8, 1);
    sim.step();
    expect(sim.world.get(e, CurrentAtomic).atomicId).toBe(HARVEST_ATOMIC); // the swing in flight survives

    sim.run(swingTicks - 1);
    // Exactly one chop landed, then the settler was released to its order - not re-armed tree-to-fall.
    expect(sim.world.get(tree, Felling).chopsLeft).toBe(4);
    expect(sim.world.has(e, CurrentAtomic)).toBe(false);
    expect(sim.world.has(e, MoveGoal)).toBe(true);
  });
});

describe('placeSignpost during a non-interruptible atomic', () => {
  it('parks the whole command, so the erect intent is not erased by its own walk', () => {
    const sim = freshSim(32, 8);
    const scout = ownedSettler(sim, 4, 2, SCOUT);
    // Mid build-guide swing (unresolved clip in the fixture -> non-interruptible by the safe default).
    startAtomic(sim, scout, BUILD_GUIDE_ATOMIC_ID, 15);

    sim.enqueueSetup({ kind: 'placeSignpost', entity: scout, x: 8, y: 4 });
    sim.step();

    // Nothing of the order landed yet - no erect intent beside a parked walk.
    expect(sim.world.get(scout, CurrentAtomic).atomicId).toBe(BUILD_GUIDE_ATOMIC_ID);
    expect(sim.world.has(scout, ErectSignpostOrder)).toBe(false);
    expect(sim.world.get(scout, DeferredOrder).command.kind).toBe('placeSignpost');

    // Swing done -> the command replays whole: the erect intent survives (as the pending order or, once
    // the scout stands at the goal, already as the build-guide swing) and the post eventually stands.
    sim.run(15);
    expect(sim.world.has(scout, DeferredOrder)).toBe(false);
    const intentAlive =
      sim.world.has(scout, ErectSignpostOrder) ||
      sim.world.tryGet(scout, CurrentAtomic)?.effect.kind === 'erectSignpost';
    expect(intentAlive).toBe(true);
    sim.run(60);
    expect([...sim.world.query(Signpost)]).toHaveLength(1);
  });
});
