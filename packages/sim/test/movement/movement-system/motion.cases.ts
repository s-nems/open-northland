import { describe, expect, it } from 'vitest';
import {
  addWildlife,
  Carrying,
  MISSION_BEHAVIOUR,
  MissionBehaviour,
  MoveSpeed,
  PathFollow,
  Position,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import { HALF_COLUMN, worldDistance } from '../../../src/nav/world-metric.js';
import { MAX_STEP_PER_TICK, MIN_STEP_TICKS } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { roughNodeMap } from '../../fixtures/terrain.js';

import { followerAt, grassMap, LAND_STEP_TICKS, pos, ticksToArrive } from './support.js';

/** The per-tick world advance recorded over a walk. */
function paceTrace(sim: Simulation, e: Entity): number[] {
  const trace: number[] = [];
  let prev = { ...sim.world.get(e, Position) };
  let guard = 0;
  while (sim.world.has(e, PathFollow)) {
    sim.step();
    const cur = sim.world.get(e, Position);
    trace.push(worldDistance(prev.x, prev.y, cur.x, cur.y));
    prev = { x: cur.x, y: cur.y };
    if (++guard > 400) throw new Error('path never completed');
  }
  return trace;
}

describe('movementSystem - constant pace: no ramp, corner loss or brake', () => {
  it('finishes minimum-cost horizontal steps in exactly three ticks in both directions', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: roughNodeMap(4, 1, () => 0) });
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 0, y: 0 },
    ]);
    sim.world.add(e, MissionBehaviour, { flags: MISSION_BEHAVIOUR.WALKS_FAST });
    expect(ticksToArrive(sim, e)).toBe(6);
    expect(pos(sim, e).x).toBe(0);
  });

  it('advances the same share every tick of a straight run, corner and last leg included', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 8) });
    // East two steps, then the half-row edge down (the original's SE step, a quarter column sideways
    // under the stagger): a real heading change at (1,0), and a final leg.
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 0.5 },
    ]);
    const trace = paceTrace(sim, e);
    expect(trace).toHaveLength(3 * LAND_STEP_TICKS);
    const column = fx.div(HALF_COLUMN, fx.fromInt(LAND_STEP_TICKS));
    // The E/W legs: every tick within a couple of ulps of the exact eighth (the equal-share division
    // truncates each tick and the last tick lands the remainder).
    for (const d of trace.slice(0, 2 * LAND_STEP_TICKS)) expect(Math.abs(d - column)).toBeLessThanOrEqual(2);
    // The half-row leg paces likewise by its own world length (within the isqrt's per-tick rounding,
    // under one percent): no corner loss at (1,0).
    const legLength = worldDistance(fx.fromInt(1), fx.fromInt(0), fx.fromInt(1), fx.fromFloat(0.5));
    const row = fx.div(legLength, fx.fromInt(LAND_STEP_TICKS));
    for (const d of trace.slice(2 * LAND_STEP_TICKS))
      expect(Math.abs(d - row)).toBeLessThanOrEqual(row / 100);
  });

  it('a reversal (180° re-target) costs nothing: the way back paces like the way out', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(ticksToArrive(sim, e)).toBe(2 * LAND_STEP_TICKS);
  });

  it('fixes a leg cost when the leg starts: a good picked up mid-leg slows the NEXT step', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
    ]);
    sim.step();
    sim.world.add(e, Carrying, { goodType: 1, amount: 1 });
    expect(sim.world.get(e, PathFollow).legCost).toBe(LAND_STEP_TICKS);
    while (sim.world.get(e, PathFollow).index < 2) sim.step();
    sim.step();
    expect(sim.world.get(e, PathFollow).legCost).toBe(LAND_STEP_TICKS + 1); // the carrying tick
  });

  it('the script pace bits are exact: slow doubles a step, fast takes two ticks off, floor 3', () => {
    const walk = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
    ];
    const paced = (flags: number): number => {
      const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
      const e = followerAt(sim, 0, 0, walk);
      sim.world.add(e, MissionBehaviour, { flags });
      return ticksToArrive(sim, e);
    };
    expect(paced(MISSION_BEHAVIOUR.WALKS_SLOWLY)).toBe(2 * LAND_STEP_TICKS);
    expect(paced(MISSION_BEHAVIOUR.WALKS_FAST)).toBe(LAND_STEP_TICKS - 2);
    expect(paced(MISSION_BEHAVIOUR.WALKS_SLOWLY | MISSION_BEHAVIOUR.WALKS_FAST)).toBe(
      2 * LAND_STEP_TICKS - 2,
    );
    expect(MIN_STEP_TICKS).toBe(3);
  });

  it('never advances past the per-tick cap: a leg pushed behind schedule is delayed, not skipped', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
    ]);
    // Shove the walker two columns back on the leg's last tick: the whole distance cannot be closed.
    for (let i = 0; i < LAND_STEP_TICKS - 1; i++) sim.step();
    sim.world.mut(e, Position).x = fx.fromInt(-2);
    const before = sim.world.get(e, Position).x;
    sim.step();
    expect(sim.world.has(e, PathFollow)).toBe(true);
    expect(fx.sub(sim.world.get(e, Position).x, before)).toBe(MAX_STEP_PER_TICK);
    expect(ticksToArrive(sim, e)).toBeGreaterThan(1); // and it still lands
    expect(pos(sim, e).x).toBe(0.5);
  });
});

describe('movementSystem - per-entity pace (MoveSpeed)', () => {
  it('keeps source-default wildlife on its animal fallback, not the human terrain gait', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    addWildlife(sim.world, e, 10);
    expect(sim.world.has(e, MoveSpeed)).toBe(false);
    expect(ticksToArrive(sim, e)).toBe(18);
  });

  it('a MoveSpeed follower advances at its own constant perTick, not the human step cost', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    // A creature paced ONE/16: 4096 ulp a tick from the first tick, no ramp.
    sim.world.add(e, MoveSpeed, { perTick: fx.div(ONE, fx.fromInt(16)) });
    sim.step();
    expect(sim.world.get(e, Position).x).toBe(fx.div(ONE, fx.fromInt(16)));
    sim.step();
    expect(sim.world.get(e, Position).x).toBe(fx.div(ONE, fx.fromInt(8)));
    expect(sim.world.get(e, PathFollow).legCost).toBe(0); // no step cost is read for a creature
  });

  it('a degenerate few-ulp gait still completes (the ULP floor prevents a permanent stall)', () => {
    // `ONE/movespeed` truncation can mint a perTick of 2 (movespeed 30000) or even 0 (movespeed
    // > 65536); an unguarded 0-ulp gait would make no progress, ever - the walker never moves and the
    // path never completes. The one-ULP gait floor keeps such a walker absurdly slow but the sim total.
    // Short legs so the crawl fits a bounded test.
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
    // 1-ulp step truncates to (0,0) - without stepTowardPoint's dominant-component ulp guard this
    // walker stalled forever (the arrival snap needs dist <= speed, which a stationary walker never
    // reaches). The guard advances one grid ulp per tick, so the crawl still terminates.
    const diagonalWalker = followerAt(sim, 0, 0, [{ x: 0.002, y: 0.002 }]);
    sim.world.add(diagonalWalker, MoveSpeed, { perTick: fx.div(ONE, fx.fromInt(70000)) });
    expect(ticksToArrive(sim, diagonalWalker, 1000)).toBeGreaterThan(0);
    const arrived = sim.world.get(diagonalWalker, Position);
    expect(arrived.x).toBe(fx.fromFloat(0.002)); // the arrival snap, bit-exact
    expect(arrived.y).toBe(fx.fromFloat(0.002));
  });

  it('reaches a one-tile waypoint in 16 ticks at ONE/16: the constant creature pace', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    sim.world.add(e, MoveSpeed, { perTick: fx.div(ONE, fx.fromInt(16)) });
    expect(ticksToArrive(sim, e)).toBe(16);
    expect(pos(sim, e).x).toBe(1);
  });
});
