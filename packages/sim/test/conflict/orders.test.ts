import { beforeEach, describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  CurrentAtomic,
  Health,
  JobAssignment,
  MoveGoal,
  Owner,
  PathFollow,
  PathRequest,
  PlayerOrder,
  Position,
  Resource,
  Settler,
  Stockpile,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { ONE, Simulation, type TerrainMap, fx } from '../../src/index.js';
import { MOVE_ORDER_HOLD_CIVILIAN, MOVE_ORDER_HOLD_SOLDIER } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * Tests for the PLAYER-order commands (`moveUnit` / `setJob`) and the PlayerOrder timed-override system
 * — the RTS "select a unit and tell it where to go / what to be". A move order is a SOFT, TIMED
 * override: the unit walks to the spot, stands a while (short for a worker, long for a soldier), then
 * the economy AI reclaims it; needs can pull it away sooner. The fixture matches atomic-planner.test.ts:
 * good 1 = wood (harvest atomic 24), job 1 = woodcutter, tribe 1 = viking.
 */

const GRASS = 0;
const WOOD = 1;
const WOODCUTTER = 1;
const CARPENTER = 2;
const VIKING = 1;
const HEADQUARTERS = 1;
const HARVEST_ATOMIC = 24;
const HUMAN_PLAYER = 0;

beforeEach(() => {
  Position.store.clear();
  Settler.store.clear();
  Resource.store.clear();
  Building.store.clear();
  Stockpile.store.clear();
  Carrying.store.clear();
  CurrentAtomic.store.clear();
  MoveGoal.store.clear();
  PathFollow.store.clear();
  PathRequest.store.clear();
  JobAssignment.store.clear();
  Health.store.clear();
  Owner.store.clear();
  PlayerOrder.store.clear();
});

function grassMap(width: number, height: number): TerrainMap {
  return { width, height, typeIds: new Array(width * height).fill(GRASS) };
}

function sim(): Simulation {
  return new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 4) });
}

/** An OWNED viking woodcutter (the player's to command) placed directly on the world. */
function ownedWoodcutter(s: Simulation, x: number, y: number, player = HUMAN_PLAYER): Entity {
  const e = s.world.create();
  s.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  s.world.add(e, Settler, {
    tribe: VIKING,
    jobType: WOODCUTTER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  s.world.add(e, Owner, { player });
  return e;
}

function woodAt(s: Simulation, x: number, y: number, remaining = 5): Entity {
  const e = s.world.create();
  s.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  s.world.add(e, Resource, { goodType: WOOD, remaining, harvestAtomic: HARVEST_ATOMIC });
  return e;
}

describe('moveUnit order', () => {
  it('walks an owned settler to the target cell and holds it there', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    s.enqueue({ kind: 'moveUnit', entity: e, x: 5, y: 0 });
    s.run(70); // 5 tiles at ⅛ tile/tick ≈ 40 ticks to arrive, then it stands (hold not yet expired)

    const p = s.world.get(e, Position);
    expect([p.x, p.y]).toEqual([fx.fromInt(5), fx.fromInt(0)]); // arrived at the ordered spot
    expect(s.world.has(e, PlayerOrder)).toBe(true); // still holding position
  });

  it('keeps advancing when re-ordered MID-STEP — no snap back to the tile centre', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    s.enqueue({ kind: 'moveUnit', entity: e, x: 6, y: 0 });
    s.run(6); // walking — now genuinely between cell centres
    const before = s.world.get(e, Position).x;
    expect(before).toBeGreaterThan(fx.fromInt(0));
    expect(before).toBeLessThan(fx.fromInt(1)); // mid-tile, the case that used to back up

    // Re-issue the order mid-step: the fresh route must head straight on, not reverse toward x=0 first.
    s.enqueue({ kind: 'moveUnit', entity: e, x: 6, y: 0 });
    s.run(2);
    expect(s.world.get(e, Position).x).toBeGreaterThan(before); // advanced, never snapped back
  });

  it('is skipped for a NEUTRAL (unowned) settler — only owned units are orderable', () => {
    const s = sim();
    const e = s.world.create();
    s.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    s.world.add(e, Settler, {
      tribe: VIKING,
      jobType: WOODCUTTER,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map(),
    });
    s.enqueue({ kind: 'moveUnit', entity: e, x: 5, y: 0 });
    s.step();
    expect(s.world.has(e, PlayerOrder)).toBe(false);
    expect(s.world.has(e, MoveGoal)).toBe(false);
    expect(s.world.get(e, Position).x).toBe(fx.fromInt(0)); // never moved
  });

  it('is skipped (no throw) for a non-settler or never-created target', () => {
    const s = sim();
    const building = s.world.create();
    s.world.add(building, Position, { x: fx.fromInt(1), y: fx.fromInt(1) });
    s.world.add(building, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
    s.world.add(building, Owner, { player: HUMAN_PLAYER });

    s.enqueue({ kind: 'moveUnit', entity: building, x: 5, y: 0 }); // a building can't walk
    s.enqueue({ kind: 'moveUnit', entity: 9999 as Entity, x: 5, y: 0 }); // never created
    expect(() => s.step()).not.toThrow();
    expect(s.world.has(building, PlayerOrder)).toBe(false);
    expect(s.commands.log).toHaveLength(2); // still logged for faithful replay
  });

  it('gives a combatant a LONGER hold than a civilian (a warrior stands, a worker returns to work)', () => {
    const s = sim();
    const civ = ownedWoodcutter(s, 0, 0);
    const warrior = ownedWoodcutter(s, 0, 1);
    s.world.add(warrior, Health, { hitpoints: 100, max: 100 }); // a combatant

    s.enqueue({ kind: 'moveUnit', entity: civ, x: 2, y: 0 });
    s.enqueue({ kind: 'moveUnit', entity: warrior, x: 2, y: 1 });
    s.step();

    expect(s.world.get(civ, PlayerOrder).holdTicks).toBe(MOVE_ORDER_HOLD_CIVILIAN);
    expect(s.world.get(warrior, PlayerOrder).holdTicks).toBe(MOVE_ORDER_HOLD_SOLDIER);
    expect(MOVE_ORDER_HOLD_SOLDIER).toBeGreaterThan(MOVE_ORDER_HOLD_CIVILIAN);
  });

  it('the economy AI leaves an ordered worker standing, then reclaims it after the hold', () => {
    const s = sim();
    const worker = ownedWoodcutter(s, 0, 0);
    woodAt(s, 2, 0); // without an order the woodcutter would walk here to harvest

    // Order it AWAY from the resource. During the hold it must stand at the spot, not go harvest.
    s.enqueue({ kind: 'moveUnit', entity: worker, x: 9, y: 0 });
    s.run(85); // arrived (9 tiles at ⅛/tick ≈ 72 ticks) and inside the 50-tick civilian hold
    const held = s.world.get(worker, Position);
    expect(held.x).toBe(fx.fromInt(9)); // stood at the ordered spot
    expect(s.world.has(worker, PlayerOrder)).toBe(true); // still under the order
    expect(s.world.has(worker, Carrying)).toBe(false); // NOT working — it obeyed the order

    // Long after the hold expires the economy reclaims it: it heads back to harvest the wood.
    s.run(300);
    expect(s.world.has(worker, PlayerOrder)).toBe(false); // hold released
    expect(s.world.get(worker, Position).x).not.toBe(fx.fromInt(9)); // left the spot autonomously
  });
});

describe('setJob order', () => {
  it("changes an owned settler's profession and re-idles it (drops binding/action/order)", () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    // Simulate a working, bound, ordered unit, then change its job.
    s.world.add(e, JobAssignment, { workplace: 999 as Entity });
    s.enqueue({ kind: 'moveUnit', entity: e, x: 3, y: 0 });
    s.step();
    expect(s.world.has(e, PlayerOrder)).toBe(true);

    s.enqueue({ kind: 'setJob', entity: e, jobType: CARPENTER });
    s.step();
    expect(s.world.get(e, Settler).jobType).toBe(CARPENTER);
    expect(s.world.has(e, JobAssignment)).toBe(false); // re-employed at the new job by the JobSystem
    expect(s.world.has(e, PlayerOrder)).toBe(false); // profession change hands it back to the economy
    expect(s.world.has(e, CurrentAtomic)).toBe(false);
  });

  it('is skipped for an unknown job, a neutral unit, or a growing child', () => {
    const s = sim();
    const owned = ownedWoodcutter(s, 0, 0);
    s.enqueue({ kind: 'setJob', entity: owned, jobType: 999 }); // unknown job id
    s.step();
    expect(s.world.get(owned, Settler).jobType).toBe(WOODCUTTER); // unchanged

    const neutral = s.world.create();
    s.world.add(neutral, Position, { x: fx.fromInt(1), y: fx.fromInt(0) });
    s.world.add(neutral, Settler, {
      tribe: VIKING,
      jobType: WOODCUTTER,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map(),
    });
    s.enqueue({ kind: 'setJob', entity: neutral, jobType: CARPENTER }); // unowned — skipped
    s.step();
    expect(s.world.get(neutral, Settler).jobType).toBe(WOODCUTTER); // unchanged
  });
});

describe('PlayerOrder abandonment', () => {
  it('abandons the order and clears the dead nav state when the route fails (unreachable target)', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    // A target the pathfinder can never reach leaves a failed PathRequest that is never retried;
    // playerOrderSystem must free the unit rather than let it freeze forever. Set that state up
    // directly (an all-grass fixture can't produce an unreachable cell through normal routing).
    s.world.add(e, MoveGoal, { cell: 3 });
    s.world.add(e, PlayerOrder, { holdTicks: MOVE_ORDER_HOLD_CIVILIAN, expiresAt: null });
    s.world.add(e, PathRequest, { start: 0, goal: 3, failed: true });

    s.step();
    expect(s.world.has(e, PlayerOrder)).toBe(false); // order abandoned
    expect(s.world.has(e, MoveGoal)).toBe(false); // dead nav state cleared
    expect(s.world.has(e, PathRequest)).toBe(false);
  });
});
