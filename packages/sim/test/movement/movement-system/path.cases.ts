import { describe, expect, it } from 'vitest';
import { PathFollow, Position, Velocity } from '../../../src/components/index.js';
import { fx, Simulation } from '../../../src/index.js';
import { movementSystem } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { roughNodeMap } from '../../fixtures/terrain.js';

import { followerAt, grassMap, LAND_STEP_TICKS, pos, ticksToArrive, waypointAt } from './support.js';

/** A cell-long E/W walk east from node column 0: two half-column stops per cell. */
const halfSteps = (cells: number): Array<{ x: number; y: number }> =>
  Array.from({ length: cells * 2 + 1 }, (_, i) => ({ x: i / 2, y: 0 }));

describe('movementSystem - path following', () => {
  it('walks a half-column step in exactly its step cost, closing equal shares each tick', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const e = followerAt(sim, 0, 0, halfSteps(1));
    for (let tick = 1; tick < LAND_STEP_TICKS; tick++) {
      sim.step();
      // Each tick covers an eighth of the half column, to the ulp the equal-share division truncates.
      expect(pos(sim, e).x).toBeCloseTo(0.5 * (tick / LAND_STEP_TICKS), 4);
      expect(sim.world.get(e, PathFollow).index).toBe(1);
    }
    sim.step();
    expect(sim.world.get(e, Position).x).toBe(fx.fromFloat(0.5)); // the last tick lands exactly
    expect(sim.world.get(e, PathFollow).index).toBe(2);
    expect(sim.world.get(e, PathFollow).legTicks).toBe(0); // the next leg's cost is read when it starts
    expect(sim.world.get(e, PathFollow).legCost).toBe(0);
  });

  it('crosses a cell (two steps) in 16 ticks bare on land, every cell the same', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const e = followerAt(sim, 0, 0, halfSteps(3));
    expect(ticksToArrive(sim, e)).toBe(3 * 2 * LAND_STEP_TICKS);
    expect(pos(sim, e).x).toBeCloseTo(3, 6);
  });

  it('paces every step by the roughness of the node it LEAVES', () => {
    // Nodes 0..3 along row 0 carry roughness 1, 3, 5, 0: the step off each costs 2r + 4 ticks.
    const roughness = [1, 3, 5, 0];
    const map = roughNodeMap(8, 1, (hx) => roughness[hx] ?? 2);
    const sim = new Simulation({ seed: 1, content: testContent(), map });
    const e = followerAt(sim, 0, 0, halfSteps(1.5));
    const legs: number[] = [];
    let ticks = 0;
    let index = 1;
    while (sim.world.has(e, PathFollow)) {
      sim.step();
      ticks++;
      const pf = sim.world.tryGet(e, PathFollow);
      if (pf === undefined || pf.index !== index) {
        legs.push(ticks);
        ticks = 0;
        index++;
      }
    }
    expect(legs).toEqual([6, 10, 14]); // roads (1) are the fast lane, snow (5) the slow one
  });

  it('adds heading changes to the same per-step cost on a bent route', () => {
    // The E/W half column (34 px), the half-row edge and a diagonal edge's half (each an original
    // 25.5 px step under the stagger) all cost one step of ticks, like the original's accumulator.
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 6) });
    const e = followerAt(sim, 1, 1, [
      { x: 1, y: 1 },
      { x: 1.5, y: 1 }, // E half column
      { x: 1.5, y: 1.5 }, // SW under the stagger
      { x: 1.75, y: 2 }, // S: world X stays constant
    ]);
    expect(ticksToArrive(sim, e)).toBe(3 * LAND_STEP_TICKS + 2); // E → SW: three sectors, two held ticks
  });

  it('a route with a lone stop walks onto its centre in one step', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromFloat(0.25), y: fx.fromInt(0) });
    sim.world.add(e, PathFollow, { waypoints: [waypointAt(sim, 0.5, 0)], index: 0, legTicks: 0, legCost: 0 });
    expect(ticksToArrive(sim, e)).toBe(LAND_STEP_TICKS + 2); // initial SW → E
    expect(pos(sim, e)).toEqual({ x: 0.5, y: 0 });
  });

  it('drops the PathFollow when the final waypoint is reached', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(2, 1) });
    const e = followerAt(sim, 0, 0, [{ x: 0, y: 0 }]); // single waypoint = the node stood on
    sim.step();
    expect(sim.world.has(e, PathFollow)).toBe(false);
    expect(pos(sim, e)).toEqual({ x: 0, y: 0 });
  });

  it('walks a vertical leg dead straight on screen: worldX constant through the midpoint stop', () => {
    // The two halves of a vertical S step (cell centre -> midpoint -> cell centre, as routing.ts splices
    // them): grid x bends half a column left and back, EXACTLY cancelling the stagger's triangle wave -
    // so the world x (what the render projects) never moves. This is the sim-side guarantee behind
    // "ordered straight down, walks straight down".
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 5) });
    const e = followerAt(sim, 2, 0, [
      { x: 2, y: 0 },
      { x: 1.5, y: 1 }, // the midpoint (routing writes fractional waypoints; followerAt scales floats)
      { x: 2, y: 2 },
    ]);
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
});

describe('movementSystem - precedence: PathFollow over Velocity', () => {
  it('a path-driven entity ignores its Velocity (moves once, toward the path)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(e, Velocity, { x: fx.fromInt(1), y: fx.fromInt(0) }); // would push +1/tick east
    sim.world.add(e, PathFollow, {
      waypoints: [waypointAt(sim, 0, 0), waypointAt(sim, 0.5, 0)],
      index: 1,
      legTicks: 0,
      legCost: 0,
    });
    sim.step();
    // If Velocity had also applied, x would jump by +1/tick; the paced path-follow alone gives one
    // eighth of the half column.
    expect(sim.world.get(e, Position).x).toBe(fx.div(fx.fromFloat(0.5), fx.fromInt(LAND_STEP_TICKS)));
  });

  it('does not velocity-integrate on the same tick the path completes (no double-move)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(2, 1) });
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(e, Velocity, { x: fx.fromInt(1), y: fx.fromInt(0) });
    // Single-waypoint path on the entity's own node: it completes (PathFollow removed) THIS tick.
    sim.world.add(e, PathFollow, { waypoints: [waypointAt(sim, 0, 0)], index: 0, legTicks: 0, legCost: 0 });
    sim.step();
    // The path was handled this tick, so Velocity must NOT also apply - position stays at the cell.
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

describe('movementSystem - determinism', () => {
  it('two same-seed sims following the same path reach the same state hash', () => {
    // Each sim owns its stores, so two same-seed runs are independent; compare the final hashes -
    // same seed + same path must yield byte-identical state.
    const runOne = (): string => {
      const s = new Simulation({ seed: 5, content: testContent(), map: grassMap(10, 1) });
      followerAt(s, 0, 0, halfSteps(4));
      for (let i = 0; i < 20; i++) s.step();
      return s.hashState();
    };
    expect(runOne()).toBe(runOne());
  });
});

describe('movementSystem - invoked directly (unit, no sim)', () => {
  it('no-ops on an entity with neither PathFollow nor Velocity', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(2), y: fx.fromInt(3) });
    movementSystem(sim.world, {
      content: testContent(),
      rng: sim.rng,
      tick: 0,
      events: sim.events,
      commands: sim.commands,
    });
    expect(pos(sim, e)).toEqual({ x: 2, y: 3 });
  });
});
