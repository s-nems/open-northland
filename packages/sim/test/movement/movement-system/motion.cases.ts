import { describe, expect, it } from 'vitest';
import { MoveSpeed, PathFollow, Position } from '../../../src/components/index.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import { MOVE_SPEED_PER_TICK, WALK_TICKS_PER_CELL } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';

import { ACCEL_STEP, followerAt, grassMap, pos, ticksToArrive } from './support.js';

describe('movementSystem — inertia: corners and braking', () => {
  it('sheds speed through a corner (momentum projected onto the new heading) and recovers', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 8) });
    // East for two cells, then the SE lattice edge — a real heading change at (2,0).
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
    ]);
    // Walk until the corner waypoint (2,0) has just been consumed: index now points at (2,1).
    while (sim.world.get(e, PathFollow).index < 3) sim.step();
    const afterTurn = sim.world.get(e, PathFollow).speed;
    // The E heading is (ONE, 0); the SE edge heading ≈ (0.667, 0.745) in world axes — the dot is
    // ≈ 0.667·ONE, so the corner keeps ≈ ⅔ of the cruise gait: visibly slowed, far from a stop.
    expect(afterTurn).toBeLessThan(MOVE_SPEED_PER_TICK);
    expect(afterTurn).toBeGreaterThan(fx.div(MOVE_SPEED_PER_TICK, fx.fromInt(2)));
    // And the ramp recovers it: within ACCEL_TICKS the gait is back at the brake-shaped target,
    // which mid-leg equals the full gait until the final approach.
    sim.step();
    expect(sim.world.get(e, PathFollow).speed).toBeGreaterThan(afterTurn);
  });

  it('collinear waypoints cost nothing: a straight run never sheds speed at cell centres', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ]);
    // Once at cruise, the speed must sit at exactly G through every interior cell boundary
    // (bit-identical headings skip the projection): sample it across two full interior cells.
    while (sim.world.get(e, PathFollow).index < 2) sim.step();
    for (let i = 0; i < 2 * WALK_TICKS_PER_CELL; i++) {
      sim.step();
      expect(sim.world.get(e, PathFollow).speed).toBe(MOVE_SPEED_PER_TICK);
    }
  });

  it('brakes into the final waypoint: the last approach is slower than cruise, then snaps on', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
    // Record the gait over the whole trip; the tail must ease out (strictly below cruise) and the
    // very last recorded speed is the floored touch-down pace, G/3-ish, not a dead stop mid-stride.
    const speeds: number[] = [];
    while (sim.world.has(e, PathFollow)) {
      sim.step();
      const pf = sim.world.tryGet(e, PathFollow);
      if (pf !== undefined) speeds.push(pf.speed);
      if (speeds.length > 100) throw new Error('path never completed');
    }
    const tail = speeds.slice(-2);
    for (const s of tail) expect(s).toBeLessThan(MOVE_SPEED_PER_TICK);
    expect(tail[tail.length - 1]).toBe(fx.divCeil(MOVE_SPEED_PER_TICK, fx.fromInt(2))); // the G/2 floor
    expect(pos(sim, e).x).toBeCloseTo(2, 6);
  });

  it('a reversal (180° re-target) stops the gait dead and re-accelerates from rest', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    // East one cell, then back west — the dot of opposite headings is negative.
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 0 },
    ]);
    while (sim.world.get(e, PathFollow).index < 2) sim.step();
    // Just arrived at (1,0) and turned around: momentum projected onto the opposite heading is 0.
    expect(sim.world.get(e, PathFollow).speed).toBe(0);
    sim.step(); // the ramp restarts from rest
    expect(sim.world.get(e, PathFollow).speed).toBe(ACCEL_STEP);
  });
});

describe('movementSystem — per-entity pace (MoveSpeed)', () => {
  it('a MoveSpeed follower ramps and advances at its own perTick, not the universal default', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    // A faster override: ONE/16 = 4096 ulp/tick gait (vs the default divCeil(ONE/18) = 3641).
    sim.world.add(e, MoveSpeed, { perTick: fx.div(ONE, fx.fromInt(16)) });
    sim.step(); // consume wp0 (already on it), index -> 1; ramp is one accel-step (divCeil(4096/3) = 1366) warm
    sim.step(); // first move toward wp1 at 2·1366 = 2732 — the entity's OWN ramp, not the default's
    expect(sim.world.get(e, Position).x).toBe(fx.fromFloat(2732 / ONE));
  });

  it('a degenerate few-ulp gait still completes (the ULP floor prevents a permanent stall)', () => {
    // `ONE/movespeed` truncation can mint a perTick of 2 (movespeed 30000) or even 0 (movespeed
    // > 65536); an unguarded 0-ulp gait would make no progress from rest, ever — the walker never
    // moves and the path never completes. The one-ULP gait floor (+ ceil-minted accel/brake
    // quanta) keeps such a walker absurdly slow but the sim total. Short legs so the crawl fits a
    // bounded test.
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const twoUlpWalker = followerAt(sim, 0, 0, [{ x: 0.002, y: 0 }]); // 131-ulp leg
    sim.world.add(twoUlpWalker, MoveSpeed, { perTick: fx.div(ONE, fx.fromInt(30000)) });
    expect(ticksToArrive(sim, twoUlpWalker, 500)).toBeGreaterThan(0);
    expect(sim.world.get(twoUlpWalker, Position).x).toBe(fx.fromFloat(0.002)); // the arrival snap, bit-exact

    const zeroGaitWalker = followerAt(sim, 0, 0, [{ x: 0.002, y: 0 }]);
    sim.world.add(zeroGaitWalker, MoveSpeed, { perTick: fx.div(ONE, fx.fromInt(70000)) });
    expect(sim.world.get(zeroGaitWalker, MoveSpeed).perTick).toBe(0); // the truncated-to-zero mint
    expect(ticksToArrive(sim, zeroGaitWalker, 500)).toBeGreaterThan(0); // floored to 1 ulp/tick

    // The NON-AXIS killer: the world metric inflates a diagonal leg past BOTH grid components, so a
    // 1-ulp step truncates to (0,0) — without stepTowardPoint's dominant-component ulp guard this
    // walker stalled forever (the arrival snap needs dist <= speed, which a stationary walker never
    // reaches). The guard advances one grid ulp per tick, so the crawl still terminates.
    const diagonalWalker = followerAt(sim, 0, 0, [{ x: 0.002, y: 0.002 }]);
    sim.world.add(diagonalWalker, MoveSpeed, { perTick: fx.div(ONE, fx.fromInt(70000)) });
    expect(ticksToArrive(sim, diagonalWalker, 1000)).toBeGreaterThan(0);
    const arrived = sim.world.get(diagonalWalker, Position);
    expect(arrived.x).toBe(fx.fromFloat(0.002)); // the arrival snap, bit-exact
    expect(arrived.y).toBe(fx.fromFloat(0.002));
  });

  it('reaches a one-tile waypoint in 19 ticks at ONE/16 (slower than the default 15)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    sim.world.add(e, MoveSpeed, { perTick: fx.div(ONE, fx.fromInt(16)) });
    // Model trace (G 4096, A 1366, floor 2048): consume; ramp 2732+4096; cruise 4096×13
    // (to rem 5460 < 2·G); brake 2730, 2048; snap (682 left) = 19 ticks.
    expect(ticksToArrive(sim, e)).toBe(19);
    expect(pos(sim, e).x).toBeCloseTo(1, 6);
  });
});
