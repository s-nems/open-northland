import { beforeEach, describe, expect, it } from 'vitest';
import { MoveSpeed, PathFollow, PathRequest, Position, Velocity } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { ONE, Simulation, type TerrainMap, fx } from '../../src/index.js';
import { MOVE_SPEED_PER_TICK, movementSystem } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * Unit + integration tests for the MovementSystem's path-following mode — the seam that consumes a
 * {@link PathFollow}, steps the entity toward each cell-centre waypoint at {@link MOVE_SPEED_PER_TICK},
 * advances the waypoint index on arrival, and drops the path when complete. The Velocity-only mode is
 * covered by the determinism golden; here we pin the path-follow behaviour and the precedence rule.
 */

const GRASS = 0;

// Component stores are module-level singletons (see pathfinding-system.test.ts), so clear the stores
// this suite touches before each case to keep membership assertions scoped to the current test.
beforeEach(() => {
  PathFollow.store.clear();
  PathRequest.store.clear();
  Position.store.clear();
  Velocity.store.clear();
  MoveSpeed.store.clear();
});

function grassMap(width: number, height: number): TerrainMap {
  return { width, height, typeIds: new Array(width * height).fill(GRASS) };
}

/** Build a mapped sim and place an entity at (x,y) with a straight-line PathFollow to the waypoints. */
function followerAt(
  sim: Simulation,
  x: number,
  y: number,
  waypoints: Array<{ x: number; y: number }>,
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, PathFollow, {
    waypoints: waypoints.map((w) => ({ x: fx.fromInt(w.x), y: fx.fromInt(w.y) })),
    index: 0,
  });
  return e;
}

function pos(sim: Simulation, e: Entity): { x: number; y: number } {
  const p = sim.world.get(e, Position);
  return { x: fx.toFloat(p.x), y: fx.toFloat(p.y) };
}

describe('movementSystem — path following', () => {
  it('consumes the start waypoint (its own cell) on the first tick, then heads to the next', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);

    // One target per tick: tick 1 reaches waypoint 0 (already standing on it) and advances the index
    // to 1 — no movement toward waypoint 1 yet. Movement toward wp1 begins on the following tick.
    sim.step();
    expect(pos(sim, e).x).toBeCloseTo(0, 6);
    expect(sim.world.get(e, PathFollow).index).toBe(1);
    sim.step();
    expect(pos(sim, e).x).toBeCloseTo(0.125, 6); // now an eighth-tile toward wp1
  });

  it('reaches a one-tile-away waypoint in eight steps once it is the active target', () => {
    expect(MOVE_SPEED_PER_TICK).toBe(fx.div(fx.fromInt(1), fx.fromInt(8)));
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    // Start already on waypoint 0, so the run is purely wp0 -> wp1 (one tile east).
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    sim.step(); // consume wp0 (already on it), index -> 1; no move toward wp1 yet
    for (let i = 0; i < 7; i++) {
      sim.step(); // +0.125 each — still short of the tile after 7 of 8 steps
      expect(sim.world.has(e, PathFollow)).toBe(true);
    }
    sim.step(); // 8th step lands exactly on wp1 (8 * 0.125 = 1.0), last waypoint -> path removed
    expect(pos(sim, e).x).toBeCloseTo(1, 6);
    expect(sim.world.has(e, PathFollow)).toBe(false); // path complete, dropped
  });

  it('drops the PathFollow when the final waypoint is reached', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(2, 1) });
    const e = followerAt(sim, 0, 0, [{ x: 0, y: 0 }]); // single waypoint = start cell
    sim.step();
    expect(sim.world.has(e, PathFollow)).toBe(false);
    expect(pos(sim, e)).toEqual({ x: 0, y: 0 });
  });

  it('walks a multi-cell path to its end cell-centre', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
    // 3 tiles to cover at 1/8 tile/tick = 24 move-steps; +1 tick to consume the start waypoint.
    for (let i = 0; i < 25; i++) sim.step();
    expect(pos(sim, e).x).toBeCloseTo(3, 6);
    expect(sim.world.has(e, PathFollow)).toBe(false);
  });

  it('advances a diagonal waypoint at the SAME tiles/tick as an axis leg (normalized, no √2 speed-up)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 4) });
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
    sim.step(); // consume wp0 (already on it); no move toward (1,1) yet
    sim.step(); // first move toward (1,1): a step of length `speed` along the diagonal
    const p1 = pos(sim, e);
    // Each axis advances speed/√2 ≈ 0.0884 (NOT the full 0.125), so the straight-line displacement is
    // exactly one settler step (0.125) — the same distance/tick an axis leg covers. The old per-axis
    // clamp moved 0.125 on BOTH axes at once (0.125·√2 ≈ 0.177/tick), the visible diagonal speed-up.
    expect(p1.x).toBeCloseTo(p1.y, 9); // symmetric heading
    expect(p1.x).toBeCloseTo(0.08837890625, 6); // speed / √2
    expect(Math.hypot(p1.x, p1.y)).toBeCloseTo(0.125, 3); // total = one axis-step, not √2 of one
    // The leg spans √2 tiles, so at 0.125 tile/tick it takes MORE ticks than the 8 an axis 1-tile leg
    // needs — the no-speed-up guarantee — and lands EXACTLY on the waypoint (the arrival snap).
    let moveTicks = 1; // the first move above
    while (sim.world.has(e, PathFollow)) {
      sim.step();
      moveTicks++;
    }
    expect(moveTicks).toBeGreaterThan(8); // a √2-longer leg cannot finish in an axis leg's 8 ticks
    expect(pos(sim, e).x).toBeCloseTo(1, 6);
    expect(pos(sim, e).y).toBeCloseTo(1, 6);
    expect(sim.world.has(e, PathFollow)).toBe(false);
  });
});

describe('movementSystem — per-entity pace (MoveSpeed)', () => {
  it('a MoveSpeed follower advances at its own perTick, not the universal default', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    // Half the settler pace: ONE/16 = 0.0625 tile/tick (vs the default ONE/8 = 0.125).
    sim.world.add(e, MoveSpeed, { perTick: fx.div(ONE, fx.fromInt(16)), runPerTick: null });
    sim.step(); // consume wp0 (already on it), index -> 1; no move toward wp1 yet
    sim.step(); // first move toward wp1 at the entity's OWN pace
    expect(pos(sim, e).x).toBeCloseTo(0.0625, 6); // a sixteenth of a tile, not an eighth
  });

  it('reaches a one-tile waypoint in sixteen steps at ONE/16 (slower than the default eight)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    sim.world.add(e, MoveSpeed, { perTick: fx.div(ONE, fx.fromInt(16)), runPerTick: null });
    sim.step(); // consume wp0; index -> 1
    for (let i = 0; i < 15; i++) {
      sim.step();
      expect(sim.world.has(e, PathFollow)).toBe(true); // still short of the tile after 15 of 16 steps
    }
    sim.step(); // 16th step lands exactly on wp1 (16 * 0.0625 = 1.0), last waypoint -> path dropped
    expect(pos(sim, e).x).toBeCloseTo(1, 6);
    expect(sim.world.has(e, PathFollow)).toBe(false);
  });
});

describe('movementSystem — precedence: PathFollow over Velocity', () => {
  it('a path-driven entity ignores its Velocity (moves once, toward the path)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(e, Velocity, { x: fx.fromInt(1), y: fx.fromInt(0) }); // would push +1/tick east
    sim.world.add(e, PathFollow, {
      waypoints: [
        { x: fx.fromInt(0), y: fx.fromInt(0) },
        { x: fx.fromInt(1), y: fx.fromInt(0) },
      ],
      index: 0,
    });
    sim.step(); // consume wp0 (already on it); no move yet
    sim.step(); // first move toward wp1
    // If Velocity had also applied, x would jump by +1/tick; path-follow alone gives 0.125/tick.
    expect(pos(sim, e).x).toBeCloseTo(0.125, 6);
  });

  it('does not velocity-integrate on the same tick the path completes (no double-move)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(2, 1) });
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(e, Velocity, { x: fx.fromInt(1), y: fx.fromInt(0) });
    // Single-waypoint path on the entity's own cell: it completes (PathFollow removed) THIS tick.
    sim.world.add(e, PathFollow, { waypoints: [{ x: fx.fromInt(0), y: fx.fromInt(0) }], index: 0 });
    sim.step();
    // The path was handled this tick, so Velocity must NOT also apply — position stays at the cell.
    expect(pos(sim, e).x).toBeCloseTo(0, 6);
    expect(sim.world.has(e, PathFollow)).toBe(false);
    // The very next tick (no path now) it resumes full-velocity movement.
    sim.step();
    expect(pos(sim, e).x).toBeCloseTo(1, 6);
  });

  it('a Velocity-only entity still integrates at full velocity', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(e, Velocity, { x: fx.fromInt(1), y: fx.fromInt(0) });
    sim.step();
    expect(pos(sim, e).x).toBeCloseTo(1, 6);
  });
});

describe('movementSystem — determinism', () => {
  it('two same-seed sims following the same path reach the same state hash', () => {
    // Component stores are module-level singletons, so two sims built at once would re-mint the same
    // ids and clobber each other's path. Run each in isolation (clearing the shared stores between),
    // and compare the final hashes — same seed + same path must yield byte-identical state.
    const runOne = (): string => {
      PathFollow.store.clear();
      Position.store.clear();
      const s = new Simulation({ seed: 5, content: testContent(), map: grassMap(5, 1) });
      followerAt(s, 0, 0, [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 4, y: 0 },
      ]);
      for (let i = 0; i < 20; i++) s.step();
      return s.hashState();
    };
    expect(runOne()).toBe(runOne());
  });
});

describe('movementSystem — invoked directly (unit, no sim)', () => {
  it('no-ops on an entity with neither PathFollow nor Velocity', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(2), y: fx.fromInt(3) });
    movementSystem(sim.world, {
      content: testContent(),
      rng: sim.rng,
      tick: 0,
      events: sim.events,
    });
    expect(pos(sim, e)).toEqual({ x: 2, y: 3 });
  });
});
