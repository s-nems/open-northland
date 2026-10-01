import { describe, expect, it } from 'vitest';
import {
  AttackOrder,
  addCurrentAtomic,
  addPerson,
  Building,
  CurrentAtomic,
  DeferredOrder,
  JobAssignment,
  MISSION_BEHAVIOUR,
  MoveGoal,
  NeedOrder,
  ORDER_QUEUE_LIMIT,
  OrderQueue,
  Owner,
  PlayerOrder,
  Position,
  Rider,
  SIGNPOST_SPACING_NODES,
  Signpost,
  Stockpile,
  setMissionBehaviour,
} from '../../src/components/index.js';
import type { Command } from '../../src/core/commands/index.js';
import { fx } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  cellAnchorNode,
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import { queueBehindCurrentOrder, sendUnit } from '../../src/systems/orders/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/** Shift-clicked orders wait behind the settler's current one and start the tick it ends. */

const VIKING = 1;
const WOODCUTTER = 1;
const SCOUT = 27; // fixture job 27 - allowatomic 43 only, like the original scout
const HUMAN_PLAYER = 0;
const EAT_ATOMIC = 10;
const EAT_TICKS = 5; // fixture `viking_eat` length
const WALK_BUDGET = 400;
const CARPENTER = 2;
const SAWMILL = 2; // fixture building type with one carpenter seat

const MAP = { width: 48, height: 8 };

function freshSim(width = MAP.width, height = MAP.height): Simulation {
  return new Simulation({ seed: 1, content: testContent(), map: grassMap(width, height) });
}

function ownedSettler(sim: Simulation, x: number, y: number, jobType: number | null): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Owner, { player: HUMAN_PLAYER });
  return e;
}

function walk(e: Entity, cx: number, cy: number, queued = false): Command {
  const n = cellAnchorNode(cx, cy);
  return { kind: 'moveUnit', entity: e, x: n.hx, y: n.hy, ...(queued ? { queued } : {}) };
}

function standsAt(sim: Simulation, e: Entity, cx: number, cy: number): boolean {
  const p = sim.world.get(e, Position);
  return fx.toInt(p.x) === cx && fx.toInt(p.y) === cy && !sim.world.has(e, PlayerOrder);
}

/** Start a meal: a non-interruptible clip, as a need drive does. */
function eat(sim: Simulation, e: Entity): void {
  addCurrentAtomic(sim.world, e, {
    atomicId: EAT_ATOMIC,
    duration: EAT_TICKS,
    effect: { kind: 'idle' },
    targetEntity: null,
    targetTile: null,
  });
}

function stepUntil(sim: Simulation, done: () => boolean, budget = WALK_BUDGET): void {
  for (let t = 0; t < budget && !done(); t++) sim.step();
}

describe('order queue', () => {
  it('a queued walk on a settler with no order applies at once', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, WOODCUTTER);
    sim.enqueueSetup(walk(e, 8, 2, true));
    sim.step();
    expect(sim.world.has(e, PlayerOrder)).toBe(true);
    expect(sim.world.has(e, OrderQueue)).toBe(false);
  });

  it('walks the queued waypoints in order, starting each the tick the one ahead arrives', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, WOODCUTTER);
    sim.enqueueSetup(walk(e, 8, 2));
    sim.enqueueSetup(walk(e, 8, 5, true));
    sim.enqueueSetup(walk(e, 14, 5, true));
    sim.step();
    expect(sim.world.get(e, OrderQueue).orders).toHaveLength(2);

    let reachedFirst = false;
    for (let t = 0; t < WALK_BUDGET && !standsAt(sim, e, 14, 5); t++) {
      sim.step();
      const p = sim.world.get(e, Position);
      if (fx.toInt(p.x) === 8 && fx.toInt(p.y) === 2) reachedFirst = true;
      // No tick between two legs leaves the settler without an order the planner could re-task.
      if (sim.world.has(e, OrderQueue)) expect(sim.world.has(e, PlayerOrder)).toBe(true);
    }
    expect(reachedFirst).toBe(true);
    expect(standsAt(sim, e, 14, 5)).toBe(true);
    expect(sim.world.has(e, OrderQueue)).toBe(false);
  });

  it('an unqueued order drops every waiting one', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, WOODCUTTER);
    sim.enqueueSetup(walk(e, 14, 2));
    sim.enqueueSetup(walk(e, 14, 5, true));
    sim.step();
    sim.enqueueSetup(walk(e, 2, 5));
    sim.step();
    expect(sim.world.has(e, OrderQueue)).toBe(false);
    stepUntil(sim, () => standsAt(sim, e, 2, 5));
    expect(standsAt(sim, e, 2, 5)).toBe(true);
  });

  it('a workplace posting drops the queue, so the new worker stays at its post', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, null);
    const mill = sim.world.create();
    sim.world.add(mill, Position, { x: fx.fromInt(6), y: fx.fromInt(4) });
    sim.world.add(mill, Building, { buildingType: SAWMILL, tribe: VIKING, built: fx.fromInt(1), level: 0 });
    sim.world.add(mill, Owner, { player: HUMAN_PLAYER });
    sim.world.add(mill, Stockpile, { amounts: new Map() });
    sim.enqueueSetup(walk(e, 20, 2));
    sim.enqueueSetup(walk(e, 40, 5, true));
    sim.step();
    sim.enqueueSetup({
      kind: 'assignWorkerGroup',
      building: mill,
      members: [{ entity: e, jobPriority: [CARPENTER] }],
    });
    sim.step();
    expect(sim.world.get(e, JobAssignment).workplace).toBe(mill);
    expect(sim.world.has(e, OrderQueue)).toBe(false);
    expect(sim.world.has(e, PlayerOrder)).toBe(false);
  });

  it('a saved queue walks on the same after a restore', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, WOODCUTTER);
    sim.enqueueSetup(walk(e, 8, 2));
    sim.enqueueSetup(walk(e, 8, 5, true));
    sim.enqueueSetup(walk(e, 14, 5, true));
    sim.step();
    const copy = restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim)))), {
      content: testContent(),
      map: grassMap(MAP.width, MAP.height),
    });
    expect(copy.world.get(e, OrderQueue).orders).toHaveLength(2);
    sim.run(WALK_BUDGET);
    copy.run(WALK_BUDGET);
    expect(copy.hashState()).toBe(sim.hashState());
    expect(standsAt(copy, e, 14, 5)).toBe(true);
  });

  it(`keeps at most ${ORDER_QUEUE_LIMIT} waiting orders`, () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, WOODCUTTER);
    sim.enqueueSetup(walk(e, 40, 2));
    for (let i = 0; i <= ORDER_QUEUE_LIMIT; i++) sim.enqueueSetup(walk(e, 3 + i, 5, true));
    sim.step();
    expect(sim.world.get(e, OrderQueue).orders).toHaveLength(ORDER_QUEUE_LIMIT);
  });

  it('parks the next leg behind a meal that took the settler off its walk', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, WOODCUTTER);
    sim.enqueueSetup(walk(e, 8, 2));
    sim.enqueueSetup(walk(e, 8, 5, true));
    sim.step();
    // A meal takes the settler off its walk, as a need drive does.
    sim.world.remove(e, PlayerOrder);
    sim.world.remove(e, MoveGoal);
    eat(sim, e);
    sim.step();
    expect(sim.world.has(e, OrderQueue)).toBe(false);
    expect(sim.world.get(e, DeferredOrder).command.kind).toBe('moveUnit');
    expect(sim.world.get(e, CurrentAtomic).atomicId).toBe(EAT_ATOMIC);
    stepUntil(sim, () => standsAt(sim, e, 8, 5));
    expect(standsAt(sim, e, 8, 5)).toBe(true);
  });

  it("does not wait for the settler's own doings: work, a breach of its own, a standing need order", () => {
    const sim = freshSim();
    const busy = ownedSettler(sim, 2, 2, WOODCUTTER);
    eat(sim, busy); // a non-interruptible clip with no order behind it
    const breaker = ownedSettler(sim, 2, 4, WOODCUTTER);
    sim.world.add(breaker, AttackOrder, {
      target: busy,
      breach: { resume: null, stand: null, enemy: busy },
    });
    const hungry = ownedSettler(sim, 2, 6, WOODCUTTER);
    sim.world.add(hungry, NeedOrder, { need: 'piety' });
    for (const e of [busy, breaker, hungry]) sim.enqueueSetup(walk(e, 12, 3, true));
    sim.step();
    for (const e of [busy, breaker, hungry]) expect(sim.world.has(e, OrderQueue)).toBe(false);
    expect(sim.world.get(busy, DeferredOrder).command.kind).toBe('moveUnit'); // parked as a plain click is
    expect(sim.world.has(breaker, PlayerOrder)).toBe(true);
    expect(sim.world.has(hungry, PlayerOrder)).toBe(true);
  });

  it('drops the queue on a work flag, a script walk and a script taking the unit', () => {
    const sim = freshSim();
    const flagged = ownedSettler(sim, 2, 2, WOODCUTTER);
    const sent = ownedSettler(sim, 2, 4, WOODCUTTER);
    const locked = ownedSettler(sim, 2, 6, WOODCUTTER);
    for (const e of [flagged, sent, locked]) {
      sim.enqueueSetup(walk(e, 20, 2));
      sim.enqueueSetup(walk(e, 20, 5, true));
    }
    sim.step();
    const flag = cellAnchorNode(4, 2);
    sim.enqueueSetup({ kind: 'setWorkFlag', entity: flagged, x: flag.hx, y: flag.hy });
    sendUnit(sim.world, ctxOf(sim), sent, flag.hx, flag.hy);
    setMissionBehaviour(sim.world, locked, MISSION_BEHAVIOUR.NOT_CONTROLLABLE, true);
    sim.step();
    for (const e of [flagged, sent, locked]) expect(sim.world.has(e, OrderQueue)).toBe(false);
  });

  it('a rider never queues: its walk orders drive or leave the vehicle at once', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, WOODCUTTER);
    sim.world.add(e, PlayerOrder, {});
    sim.world.add(e, Rider, { vehicle: e, boarding: false });
    const n = cellAnchorNode(8, 2);
    expect(
      queueBehindCurrentOrder(sim.world, { kind: 'moveUnit', entity: e, x: n.hx, y: n.hy, queued: true }),
    ).toBe(false);
  });

  it('a scout erects a queued chain of signposts one after another', () => {
    const sim = freshSim(96, 8);
    const scout = ownedSettler(sim, 2, 2, SCOUT);
    const spots = [8, 8 + SIGNPOST_SPACING_NODES, 8 + 2 * SIGNPOST_SPACING_NODES];
    spots.forEach((x, i) => {
      sim.enqueueSetup({ kind: 'placeSignpost', entity: scout, x, y: 4, ...(i > 0 ? { queued: true } : {}) });
    });
    stepUntil(sim, () => [...sim.world.query(Signpost)].length === spots.length, 3 * WALK_BUDGET);
    const posts = [...sim.world.query(Signpost)].map((post) => fx.toInt(sim.world.get(post, Position).x));
    expect(posts).toEqual(spots.map((x) => x / 2));
  });

  it('the placement overlay keeps the spacing of the posts the scout walks to and has queued', () => {
    const sim = freshSim(96, 8);
    const scout = ownedSettler(sim, 2, 2, SCOUT);
    const ROW = 4;
    const area = { minHx: 0, maxHx: 95, minHy: ROW, maxHy: ROW };
    const accepts = (hx: number): boolean => sim.signpostAnswer(HUMAN_PLAYER, area)?.accepted[hx] === 1;
    const FIRST = 20;
    const QUEUED = FIRST + SIGNPOST_SPACING_NODES;
    const FREE = QUEUED + SIGNPOST_SPACING_NODES;
    expect(accepts(FIRST + 1)).toBe(true);
    const before = sim.signpostBlockerVersion();

    sim.enqueueSetup({ kind: 'placeSignpost', entity: scout, x: FIRST, y: ROW });
    sim.enqueueSetup({ kind: 'placeSignpost', entity: scout, x: QUEUED, y: ROW, queued: true });
    sim.step();

    expect(sim.signpostBlockerVersion()).not.toBe(before);
    expect(accepts(FIRST + 1)).toBe(false); // the errand under way
    expect(accepts(QUEUED + 1)).toBe(false); // the queued post
    expect(accepts(FREE)).toBe(true);
    // The erect command judges standing posts only: a plan holds no ground against an order.
    expect(sim.signpostProbe(HUMAN_PLAYER)?.canPlace(QUEUED + 1, ROW)).toBe(true);
  });

  it('a queued signpost the spot no longer takes is skipped for the next order', () => {
    const sim = freshSim(96, 8);
    const scout = ownedSettler(sim, 2, 2, SCOUT);
    sim.enqueueSetup({ kind: 'placeSignpost', entity: scout, x: 8, y: 4 });
    // Inside the first post's spacing once it stands.
    sim.enqueueSetup({ kind: 'placeSignpost', entity: scout, x: 12, y: 4, queued: true });
    sim.enqueueSetup(walk(scout, 20, 2, true));
    stepUntil(sim, () => standsAt(sim, scout, 20, 2) && !sim.world.has(scout, OrderQueue), 2 * WALK_BUDGET);
    expect(standsAt(sim, scout, 20, 2)).toBe(true);
    expect([...sim.world.query(Signpost)]).toHaveLength(1);
  });

  it('a queued attack-move marches after the walk ahead of it', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, WOODCUTTER);
    const n = cellAnchorNode(14, 2);
    sim.enqueueSetup(walk(e, 8, 2));
    sim.enqueueSetup({ kind: 'attackMoveUnit', entity: e, x: n.hx, y: n.hy, queued: true });
    sim.step();
    expect(sim.world.get(e, PlayerOrder).attackMove).toBeUndefined();
    stepUntil(sim, () => sim.world.tryGet(e, PlayerOrder)?.attackMove !== undefined);
    expect(fx.toInt(sim.world.get(e, Position).x)).toBe(8);
    expect(sim.world.has(e, OrderQueue)).toBe(false);
  });
});
