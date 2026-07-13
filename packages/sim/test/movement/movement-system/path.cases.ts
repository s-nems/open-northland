import { describe, expect, it } from 'vitest';
import { PathFollow, Position, Velocity } from '../../../src/components/index.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import { MOVE_SPEED_PER_TICK, movementSystem, WALK_TICKS_PER_CELL } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';

import { ACCEL_STEP, FX_ZERO, followerAt, grassMap, pos, ticksToArrive } from './support.js';

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
