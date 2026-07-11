import { beforeEach, describe, expect, it } from 'vitest';
import { MoveSpeed, PathFollow, PathRequest, Position, Velocity } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, ONE, Simulation, type TerrainMap } from '../../src/index.js';
import {
  ACCEL_TICKS,
  MOVE_SPEED_PER_TICK,
  movementSystem,
  WALK_TICKS_PER_CELL,
} from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * Unit + integration tests for the MovementSystem's path-following mode — the seam that consumes a
 * {@link PathFollow}, ramps the gait (the movement-inertia approximation: accelerate from rest,
 * shed speed through corners, brake into the final waypoint), steps the entity toward each
 * cell-centre waypoint, advances the waypoint index on arrival, and drops the path when complete.
 * The Velocity-only mode is covered by the determinism golden; here we pin the path-follow
 * behaviour, the gait ramp, and the precedence rule.
 *
 * Tick-count pins are derived from the model, not observed: gait G = divCeil(ONE/12) = 5462,
 * accel A = divCeil(G/3) = 1821 per tick, brake floor F = divCeil(G/2) = 2731, brake target =
 * remaining/2 on the final leg. An E/W step at cruise is bit-exact G (fused mulDiv), so a cruise
 * cell is exactly WALK_TICKS_PER_CELL ticks.
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

const FX_ZERO = fx.fromInt(0);

/** The gait ramp's per-tick acceleration at the default walk (divCeil(G/3) — see ACCEL_TICKS). */
const ACCEL_STEP = fx.divCeil(MOVE_SPEED_PER_TICK, fx.fromInt(ACCEL_TICKS));

function grassMap(width: number, height: number): TerrainMap {
  return { resolution: 'half-cell', width, height, typeIds: new Array(width * height).fill(GRASS) };
}

/** Build a mapped sim and place an entity at (x,y) with a straight-line PathFollow to the waypoints.
 *  Waypoints go through `fx.fromFloat` (exact for the test values used) so a seam waypoint's
 *  half-column fractional x can be expressed directly. The gait starts at rest (speed 0, no heading),
 *  exactly as routing mints a fresh path. */
function followerAt(
  sim: Simulation,
  x: number,
  y: number,
  waypoints: Array<{ x: number; y: number }>,
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, PathFollow, {
    waypoints: waypoints.map((w) => ({ x: fx.fromFloat(w.x), y: fx.fromFloat(w.y) })),
    index: 0,
    speed: FX_ZERO,
    hx: FX_ZERO,
    hy: FX_ZERO,
  });
  return e;
}

function pos(sim: Simulation, e: Entity): { x: number; y: number } {
  const p = sim.world.get(e, Position);
  return { x: fx.toFloat(p.x), y: fx.toFloat(p.y) };
}

/** Step until the path completes, returning the tick count (bounded so a regression can't hang). */
function ticksToArrive(sim: Simulation, e: Entity, bound = 200): number {
  let ticks = 0;
  while (sim.world.has(e, PathFollow)) {
    sim.step();
    ticks++;
    if (ticks > bound) throw new Error('path never completed');
  }
  return ticks;
}

describe('movementSystem — path following', () => {
  it('consumes the start waypoint (its own cell) on the first tick, then heads to the next', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);

    // One target per tick: tick 1 reaches waypoint 0 (already standing on it) and advances the index
    // to 1 — no movement toward waypoint 1 yet, but the gait ramp is already one accel-step warm.
    sim.step();
    expect(pos(sim, e).x).toBeCloseTo(0, 6);
    expect(sim.world.get(e, PathFollow).index).toBe(1);
    expect(sim.world.get(e, PathFollow).speed).toBe(ACCEL_STEP);
    sim.step();
    // Second tick: the ramp reaches 2·A = 3642 and the E/W step is bit-exact that speed.
    expect(sim.world.get(e, Position).x).toBe(fx.add(ACCEL_STEP, ACCEL_STEP));
  });

  it('accelerates from rest to the full gait, then cruises at exactly MOVE_SPEED_PER_TICK', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 5, y: 0 }, // long enough that the brake horizon stays far away during the ramp
    ]);
    sim.step(); // consume wp0; speed = A
    // Ramp: A per tick until the gait is reached — 2A, then 3A overshoots and clamps onto G on the
    // third tick (the divCeil accel step makes a from-rest ramp exactly ACCEL_TICKS long).
    const speeds: number[] = [];
    for (let i = 0; i < 6; i++) {
      sim.step();
      speeds.push(sim.world.get(e, PathFollow).speed);
    }
    const A = ACCEL_STEP;
    const G = MOVE_SPEED_PER_TICK;
    expect(speeds).toEqual([2 * A, G, G, G, G, G]);
    // At cruise an E/W step advances bit-exactly G per tick (the fused mulDiv guarantee).
    const before = sim.world.get(e, Position).x;
    sim.step();
    expect(sim.world.get(e, Position).x).toBe(fx.add(before, G));
  });

  it('reaches a one-tile-away waypoint in 15 ticks: consume + ramp-up + cruise + brake ease-out', () => {
    expect(MOVE_SPEED_PER_TICK).toBe(fx.divCeil(ONE, fx.fromInt(WALK_TICKS_PER_CELL)));
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    // Start already on waypoint 0, so the run is purely wp0 -> wp1 (one tile east).
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    // Model trace (G 5462, A 1821, brake = remaining/2 floored at 2731): consume; 3642, 5462,
    // then cruise 5462×9 to 58262; brake 3637, 2731 to 64630; snap (906 left).
    expect(ticksToArrive(sim, e)).toBe(15);
    expect(pos(sim, e).x).toBeCloseTo(1, 6);
  });

  it('walks an interior cruise cell in exactly WALK_TICKS_PER_CELL ticks (no skate, no hitch)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
    // Advance until the follower has just arrived on cell 1 (index points at cell 2's waypoint and
    // the position sits exactly on x=1): from here to x=2 is a pure cruise leg — no ramp (already at
    // full gait; the headings of collinear legs are bit-identical, so no corner projection), no brake
    // (not the last leg).
    while (sim.world.get(e, PathFollow).index < 2) sim.step();
    expect(pos(sim, e).x).toBeCloseTo(1, 6);
    let ticks = 0;
    while (sim.world.get(e, PathFollow).index < 3) {
      sim.step();
      ticks++;
    }
    expect(pos(sim, e).x).toBeCloseTo(2, 6);
    expect(ticks).toBe(WALK_TICKS_PER_CELL); // 11 bit-exact G steps + the short snap step
  });

  it('walks a multi-cell path to its end cell-centre (ramp + cruise cells + final ease-out)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
    // 1 consume + 13 (first cell, ramping) + 12 (cruise cell) + 13 (last cell, braking) = 39.
    expect(ticksToArrive(sim, e)).toBe(39);
    expect(pos(sim, e).x).toBeCloseTo(3, 6);
  });

  it('paces a row-crossing lattice leg by its WORLD length (¾ of a column)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 4) });
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 0, y: 1 }, // the SE lattice edge from an even row: one row down, world length ≈ 0.75
    ]);
    sim.step(); // consume wp0 (already on it); no move toward (0,1) yet
    sim.step(); // first move toward (0,1) at 2·A
    const p1 = pos(sim, e);
    // The leg's world length is ≈0.75 of a column (49143 ulp), so a 2·A = 3642 world-step advances
    // the row coordinate by 3642/49143 ≈ 0.0741 — the grid delta scaled to the world metric. This is
    // what keeps the ON-SCREEN pace identical in every heading (51 px vs 68 px legs).
    expect(p1.x).toBeCloseTo(0, 9); // the grid delta is pure +row; the stagger lives in the render
    expect(p1.y).toBeCloseTo(3642 / 49143, 3);
    // Full leg: ramp 3642+5462(clamp), cruise 5462×6 (to rem ~7267 < 2·G), brake ~3633, 2731,
    // snap — 11 moving ticks (vs 15 for the ⁴⁄₃-longer E/W cell trip: same world pace).
    let moveTicks = 1; // the first move above
    while (sim.world.has(e, PathFollow)) {
      sim.step();
      moveTicks++;
      if (moveTicks > 50) throw new Error('leg never completed');
    }
    expect(moveTicks).toBe(11);
    expect(pos(sim, e).y).toBeCloseTo(1, 6);
  });

  it('drops the PathFollow when the final waypoint is reached', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(2, 1) });
    const e = followerAt(sim, 0, 0, [{ x: 0, y: 0 }]); // single waypoint = start cell
    sim.step();
    expect(sim.world.has(e, PathFollow)).toBe(false);
    expect(pos(sim, e)).toEqual({ x: 0, y: 0 });
  });

  it('walks a vertical leg dead straight on screen: worldX constant through the seam waypoint', () => {
    // The two sub-legs of a vertical S step (cell centre -> seam -> cell centre, as routing.ts
    // splices them): grid x bends half a column left and back, EXACTLY cancelling the stagger's
    // triangle wave — so the world x (what the render projects) never moves. This is the sim-side
    // guarantee behind "ordered straight down, walks straight down".
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 5) });
    const e = followerAt(sim, 2, 0, [
      { x: 2, y: 0 },
      { x: 1.5, y: 1 }, // the seam (routing writes fractional waypoints; followerAt scales floats)
      { x: 2, y: 2 },
    ]);
    sim.step(); // consume wp0
    let guard = 0;
    while (sim.world.has(e, PathFollow)) {
      sim.step();
      const p = pos(sim, e);
      const shift = Math.abs(p.y % 2) <= 1 ? Math.abs(p.y % 2) / 2 : 1 - Math.abs(p.y % 2) / 2;
      expect(p.x + shift).toBeCloseTo(2, 3); // worldX = grid x + stagger shift stays on the column
      if (++guard > 100) throw new Error('leg never completed');
    }
    expect(pos(sim, e)).toEqual({ x: 2, y: 2 });
  });

  it('paces an off-lattice re-path leg by the world metric too (no lurch)', () => {
    // (0,0) -> (1,1) is NOT a lattice edge (a re-path can still aim anywhere): its world length is
    // √(1.5² + 0.5588²) ≈ 1.6 columns (104905 ulp). Ramp 3642+5462, cruise 5462×16 (to rem ~8409
    // < 2·G), brake ~4204, 2731, snap — 21 moving ticks. The point is the pace stays the same
    // world-distance-per-tick as every other heading.
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 4) });
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
    sim.step(); // consume wp0
    let moveTicks = 0;
    while (sim.world.has(e, PathFollow)) {
      sim.step();
      moveTicks++;
      if (moveTicks > 50) throw new Error('leg never completed');
    }
    expect(moveTicks).toBe(21);
    expect(pos(sim, e).x).toBeCloseTo(1, 6);
    expect(pos(sim, e).y).toBeCloseTo(1, 6); // lands EXACTLY on the waypoint (the arrival snap)
  });
});

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
    // A slower walker: ONE/16 = 4096 ulp/tick gait (vs the default divCeil(ONE/12) = 5462).
    sim.world.add(e, MoveSpeed, { perTick: fx.div(ONE, fx.fromInt(16)), runPerTick: null });
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
    sim.world.add(twoUlpWalker, MoveSpeed, { perTick: fx.div(ONE, fx.fromInt(30000)), runPerTick: null });
    expect(ticksToArrive(sim, twoUlpWalker, 500)).toBeGreaterThan(0);
    expect(sim.world.get(twoUlpWalker, Position).x).toBe(fx.fromFloat(0.002)); // the arrival snap, bit-exact

    const zeroGaitWalker = followerAt(sim, 0, 0, [{ x: 0.002, y: 0 }]);
    sim.world.add(zeroGaitWalker, MoveSpeed, { perTick: fx.div(ONE, fx.fromInt(70000)), runPerTick: null });
    expect(sim.world.get(zeroGaitWalker, MoveSpeed).perTick).toBe(0); // the truncated-to-zero mint
    expect(ticksToArrive(sim, zeroGaitWalker, 500)).toBeGreaterThan(0); // floored to 1 ulp/tick

    // The NON-AXIS killer: the world metric inflates a diagonal leg past BOTH grid components, so a
    // 1-ulp step truncates to (0,0) — without stepTowardPoint's dominant-component ulp guard this
    // walker stalled forever (the arrival snap needs dist <= speed, which a stationary walker never
    // reaches). The guard advances one grid ulp per tick, so the crawl still terminates.
    const diagonalWalker = followerAt(sim, 0, 0, [{ x: 0.002, y: 0.002 }]);
    sim.world.add(diagonalWalker, MoveSpeed, { perTick: fx.div(ONE, fx.fromInt(70000)), runPerTick: null });
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
    sim.world.add(e, MoveSpeed, { perTick: fx.div(ONE, fx.fromInt(16)), runPerTick: null });
    // Model trace (G 4096, A 1366, floor 2048): consume; ramp 2732+4096; cruise 4096×13
    // (to rem 5460 < 2·G); brake 2730, 2048; snap (682 left) = 19 ticks.
    expect(ticksToArrive(sim, e)).toBe(19);
    expect(pos(sim, e).x).toBeCloseTo(1, 6);
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
      speed: FX_ZERO,
      hx: FX_ZERO,
      hy: FX_ZERO,
    });
    sim.step(); // consume wp0 (already on it); no move yet
    sim.step(); // first move toward wp1
    // If Velocity had also applied, x would jump by +1/tick; the ramping path-follow alone gives
    // the two-accel-steps advance.
    expect(sim.world.get(e, Position).x).toBe(fx.add(ACCEL_STEP, ACCEL_STEP));
  });

  it('does not velocity-integrate on the same tick the path completes (no double-move)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(2, 1) });
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(e, Velocity, { x: fx.fromInt(1), y: fx.fromInt(0) });
    // Single-waypoint path on the entity's own cell: it completes (PathFollow removed) THIS tick.
    sim.world.add(e, PathFollow, {
      waypoints: [{ x: fx.fromInt(0), y: fx.fromInt(0) }],
      index: 0,
      speed: FX_ZERO,
      hx: FX_ZERO,
      hy: FX_ZERO,
    });
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
