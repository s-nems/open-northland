import { describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  Health,
  MoveGoal,
  Owner,
  PathFollow,
  PlayerOrder,
  Position,
  Settler,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, ONE } from '../../../src/index.js';
import { worldDistance } from '../../../src/nav/metric.js';
import { ACCEL_TICKS, MOVE_SPEED_PER_TICK } from '../../../src/systems/index.js';
import {
  HEADQUARTERS,
  HUMAN_PLAYER,
  orderMove,
  ownedWoodcutter,
  sim,
  VIKING,
  WOODCUTTER,
  woodAt,
} from './support.js';

describe('moveUnit order', () => {
  it('walks an owned settler to the target cell and releases it the tick it arrives (zero dwell)', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    orderMove(s, e, 5, 0);
    s.run(105); // 5 tiles at 18 ticks/tile plus ramp/brake; the civilian hold is zero

    const p = s.world.get(e, Position);
    expect([p.x, p.y]).toEqual([fx.fromInt(5), fx.fromInt(0)]); // arrived at the ordered spot
    // A civilian is handed back to the economy the moment it gets there — the order never parks it
    // (with nothing to do on this empty map it simply stands, but as a FREE unit).
    expect(s.world.has(e, PlayerOrder)).toBe(false);
  });

  it('keeps advancing when re-ordered MID-STEP — no snap back to the tile centre', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    orderMove(s, e, 6, 0);
    s.run(6); // walking — now genuinely between node centres
    const before = s.world.get(e, Position).x;
    expect(before).toBeGreaterThan(fx.fromInt(0));
    expect(before).toBeLessThan(fx.fromInt(1)); // mid-tile, the case that used to back up

    // Re-issue the order mid-step: the fresh route must head straight on, not reverse toward x=0 first.
    orderMove(s, e, 6, 0);
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

  it('releases a combatant on arrival exactly like a worker — no post-arrival hold', () => {
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
    // unit — a DEFEND stance (its relocated anchor) is the position-holding tool now.
    expect(released).toBe(true);
  });

  it('carries momentum through a mid-walk redirect (no dead stop, no full-speed flip)', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    orderMove(s, e, 9, 0);
    s.run(20); // cruising east at full gait, mid-tile
    expect(s.world.get(e, PathFollow).speed).toBe(MOVE_SPEED_PER_TICK);

    // Redirect around a corner: the splice must keep PART of the pace (a turn sheds cos(angle),
    // never all of it, and never keeps a reversal's full pace). Before the fix moveUnit dropped the
    // PathFollow, so every redirect re-accelerated from rest.
    orderMove(s, e, 3, 3);
    s.step();
    const spliced = s.world.get(e, PathFollow).speed;
    const accelStep = fx.divCeil(MOVE_SPEED_PER_TICK, fx.fromInt(ACCEL_TICKS));
    expect(spliced).toBeGreaterThan(accelStep); // more than a from-rest ramp tick — momentum survived
    expect(spliced).toBeLessThanOrEqual(MOVE_SPEED_PER_TICK); // and never above the cruise gait
  });

  it('never moves faster than the cruise gait, even under rapid flip-flopping orders', () => {
    // The reported floor slide: spam-clicking opposite directions rerouted the walker at FULL
    // carried speed with no corner projection at the splice, so it flipped 180° without slowing.
    // Speed must stay ≤ the walk gait every single tick; the only variation allowed is the light
    // ease-in/out of the movement-inertia approximation (routing.ts / movement.ts).
    const s = sim();
    const e = ownedWoodcutter(s, 5, 0);
    let prev = { ...s.world.get(e, Position) };
    for (let t = 0; t < 80; t++) {
      // A fresh contradictory order every 3 ticks, whipping the walker east/west.
      if (t % 3 === 0) orderMove(s, e, t % 2 === 0 ? 0 : 11, 0);
      s.step();
      const cur = s.world.get(e, Position);
      expect(worldDistance(prev.x, prev.y, cur.x, cur.y)).toBeLessThanOrEqual(MOVE_SPEED_PER_TICK);
      prev = { ...cur };
    }
  });

  it('the economy AI leaves an ordered worker alone en route, then reclaims it ON arrival', () => {
    const s = sim();
    const worker = ownedWoodcutter(s, 0, 0);
    woodAt(s, 2, 0); // without an order the woodcutter would walk here to harvest

    // Order it AWAY from the resource. While the order stands (the walk) it must obey, not harvest.
    orderMove(s, worker, 9, 0);
    s.run(60); // mid-walk (9 tiles ≈ 110 ticks with the gait ramp)
    expect(s.world.has(worker, PlayerOrder)).toBe(true); // still obeying the order
    expect(s.world.has(worker, Carrying)).toBe(false); // NOT working — it walks where it was sent

    // The tick it arrives the zero civilian dwell releases it and the economy re-tasks it at once:
    // it turns around and heads back to the wood — a detour, never a parking order.
    s.run(300);
    expect(s.world.has(worker, PlayerOrder)).toBe(false); // released on arrival
    expect(s.world.get(worker, Position).x).not.toBe(fx.fromInt(9)); // went straight back to work
  });
});
