import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  Carrying,
  DeferredOrder,
  Fleeing,
  Health,
  MoveGoal,
  Owner,
  PathFollow,
  PathRequest,
  PlayerOrder,
  Position,
  SupplyRun,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, ONE } from '../../../src/index.js';
import { worldDistance } from '../../../src/nav/world-metric.js';
import { MAX_STEP_PER_TICK } from '../../../src/systems/index.js';
import {
  collectInboundSupply,
  inboundSupplyOf,
  reservedSourceSupplyOf,
} from '../../../src/systems/stores/index.js';
import {
  HEADQUARTERS,
  HUMAN_PLAYER,
  orderMove,
  ownedWoodcutter,
  sim,
  VIKING,
  WOOD,
  WOODCUTTER,
  woodAt,
} from './support.js';

describe('moveUnit order', () => {
  it('walks an owned settler to the target cell and releases it the tick it arrives (zero dwell)', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    orderMove(s, e, 5, 0);
    s.run(105); // 5 tiles at 16 ticks/tile, with room to spare; the civilian hold is zero

    const p = s.world.get(e, Position);
    expect([p.x, p.y]).toEqual([fx.fromInt(5), fx.fromInt(0)]); // arrived at the ordered spot
    // A civilian is handed back to the economy the moment it gets there - the order never parks it
    // (with nothing to do on this empty map it simply stands, but as a FREE unit).
    expect(s.world.has(e, PlayerOrder)).toBe(false);
  });

  it("releases a construction run's source and destination promises when the player interrupts it", () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    const source = s.world.create();
    const site = s.world.create();
    s.world.add(e, SupplyRun, { source, site, goodType: WOOD, amount: 2 });
    const before = collectInboundSupply(s.world);
    expect(reservedSourceSupplyOf(before, source, WOOD)).toBe(2);
    expect(inboundSupplyOf(before, site, WOOD)).toBe(2);

    orderMove(s, e, 5, 0);
    s.step();

    expect(s.world.has(e, SupplyRun)).toBe(false);
    const after = collectInboundSupply(s.world);
    expect(reservedSourceSupplyOf(after, source, WOOD)).toBe(0);
    expect(inboundSupplyOf(after, site, WOOD)).toBe(0);
  });

  it('keeps advancing when re-ordered MID-STEP - no snap back to the tile centre', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    orderMove(s, e, 6, 0);
    s.run(6); // walking - now genuinely between node centres
    const before = s.world.get(e, Position).x;
    expect(before).toBeGreaterThan(fx.fromInt(0));
    expect(before).toBeLessThan(fx.fromInt(1)); // mid-tile, the case that used to back up

    // Re-issue the order mid-step: the fresh route must head straight on, not reverse toward x=0 first.
    orderMove(s, e, 6, 0);
    s.run(2);
    expect(s.world.get(e, Position).x).toBeGreaterThan(before); // advanced, never snapped back
  });

  it('repeated clicks on the current destination preserve the active step', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    orderMove(s, e, 6, 0);
    s.run(5);
    const before = { ...s.world.get(e, PathFollow) };
    const position = s.world.get(e, Position).x;

    orderMove(s, e, 6, 0);
    s.step();
    const after = s.world.get(e, PathFollow);
    expect(after.index).toBe(before.index);
    expect(after.legCost).toBe(before.legCost);
    expect(after.legTicks).toBe(before.legTicks + 1);
    expect(s.world.get(e, Position).x).toBeGreaterThan(position);
  });

  it('retries a failed mid-walk route when the player clicks the same destination again', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    orderMove(s, e, 6, 0);
    s.run(5);
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    const goal = terrain.nodeAt(16, 0);
    // A failed redirect retains the previous live path while waiting for the next player-order pass.
    s.world.add(e, MoveGoal, { cell: goal });
    s.world.add(e, PathRequest, { start: terrain.nodeAt(0, 0), goal, failed: true });
    const before = s.world.get(e, Position).x;

    orderMove(s, e, 8, 0);
    s.step();

    expect(s.world.has(e, PlayerOrder)).toBe(true);
    expect(s.world.has(e, PathRequest)).toBe(false);
    const route = s.world.get(e, PathFollow);
    expect(route.waypoints.at(-1)?.node).toBe(goal);
    expect(s.world.get(e, Position).x).toBeGreaterThan(before);
  });

  it('a repeated click still cancels a competing flee and parked order', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    orderMove(s, e, 6, 0);
    s.run(5);
    s.world.add(e, Fleeing, { repathAt: 100, calmUntil: null });
    s.world.add(e, DeferredOrder, { command: { kind: 'moveUnit', entity: e, x: 0, y: 0 } });
    orderMove(s, e, 6, 0);
    s.step();
    expect(s.world.has(e, Fleeing)).toBe(false);
    expect(s.world.has(e, DeferredOrder)).toBe(false);
    expect(s.world.get(e, PlayerOrder).pendingGoal).toBeUndefined();
  });

  it('is skipped for a NEUTRAL (unowned) settler - only owned units are orderable', () => {
    const s = sim();
    const e = s.world.create();
    s.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    addPerson(s.world, e, {
      tribe: VIKING,
      jobType: WOODCUTTER,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map(),
    });
    orderMove(s, e, 5, 0);
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

    orderMove(s, building, 5, 0); // a building can't walk
    orderMove(s, 9999 as Entity, 5, 0); // never created
    expect(() => s.step()).not.toThrow();
    expect(s.world.has(building, PlayerOrder)).toBe(false);
    expect(s.commands.log).toHaveLength(2); // still logged for faithful replay
  });

  it('releases a combatant on arrival exactly like a worker - no post-arrival hold', () => {
    const s = sim();
    const warrior = ownedWoodcutter(s, 0, 1);
    s.world.add(warrior, Health, { hitpoints: 100, max: 100 }); // a combatant

    orderMove(s, warrior, 2, 1);
    let released = false;
    for (let t = 0; t < 100 && !released; t++) {
      s.step();
      released = !s.world.has(warrior, PlayerOrder);
    }
    // The timed soldier stand was cut (user feedback 2026-07-14): arriving ends the order for every
    // unit - a DEFEND stance (its relocated anchor) is the position-holding tool now.
    expect(released).toBe(true);
  });

  it('keeps walking through a mid-walk redirect: the new route replaces the path the same tick', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    orderMove(s, e, 9, 0);
    s.run(20); // walking east, mid-tile
    const before = { ...s.world.get(e, Position) };

    // Redirect around a corner: the spliced route starts at once from where the walker stands.
    orderMove(s, e, 3, 3);
    s.step();
    const pf = s.world.get(e, PathFollow);
    expect(pf.index).toBe(1);
    const cur = s.world.get(e, Position);
    expect(worldDistance(before.x, before.y, cur.x, cur.y)).toBeGreaterThan(0);
  });

  it('never moves faster than the per-tick cap, even under rapid flip-flopping orders', () => {
    // The reported floor slide: spam-clicking opposite directions once rerouted the walker into a
    // long spliced first leg it closed at a sprint. A leg's per-tick advance is bounded whatever its
    // length (movement/system.ts `MAX_STEP_PER_TICK`).
    const s = sim();
    const e = ownedWoodcutter(s, 5, 0);
    let prev = { ...s.world.get(e, Position) };
    for (let t = 0; t < 80; t++) {
      // A fresh contradictory order every 3 ticks, whipping the walker east/west.
      if (t % 3 === 0) orderMove(s, e, t % 2 === 0 ? 0 : 11, 0);
      s.step();
      const cur = s.world.get(e, Position);
      expect(worldDistance(prev.x, prev.y, cur.x, cur.y)).toBeLessThanOrEqual(MAX_STEP_PER_TICK);
      prev = { ...cur };
    }
  });

  it('rapid diagonal redirects use the local step pace rather than the splice distance', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 5, 5);
    let previous = { ...s.world.get(e, Position) };
    let movingTicks = 0;
    for (let tick = 0; tick < 80; tick++) {
      if (tick % 3 === 0) orderMove(s, e, tick % 2 === 0 ? 1 : 9, tick % 2 === 0 ? 1 : 9);
      s.step();
      const current = s.world.get(e, Position);
      const distance = worldDistance(previous.x, previous.y, current.x, current.y);
      // The flat map's longest ordinary step is half a column over eight ticks. Turns can hold a
      // tick, but a route splice must never turn an arbitrary first-leg length into a sprint.
      expect(distance).toBeLessThanOrEqual(fx.div(fx.fromFloat(0.5), fx.fromInt(8)) + 2);
      if (distance > 0) movingTicks++;
      previous = { ...current };
    }
    expect(movingTicks).toBeGreaterThan(10);
  });

  it('the economy AI leaves an ordered worker alone en route, then reclaims it ON arrival', () => {
    const s = sim();
    const worker = ownedWoodcutter(s, 0, 0);
    woodAt(s, 2, 0); // without an order the woodcutter would walk here to harvest

    // Order it AWAY from the resource. While the order stands (the walk) it must obey, not harvest.
    orderMove(s, worker, 9, 0);
    s.run(60); // mid-walk (9 tiles ≈ 110 ticks with the gait ramp)
    expect(s.world.has(worker, PlayerOrder)).toBe(true); // still obeying the order
    expect(s.world.has(worker, Carrying)).toBe(false); // NOT working - it walks where it was sent

    // The tick it arrives the zero civilian dwell releases it and the economy re-tasks it at once:
    // it turns around and heads back to the wood - a detour, never a parking order.
    s.run(300);
    expect(s.world.has(worker, PlayerOrder)).toBe(false); // released on arrival
    expect(s.world.get(worker, Position).x).not.toBe(fx.fromInt(9)); // went straight back to work
  });
});
