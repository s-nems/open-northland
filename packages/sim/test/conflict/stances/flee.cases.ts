import { describe, expect, it } from 'vitest';
import { Fleeing, MoveGoal, PathFollow, Position, Settler } from '../../../src/components/index.js';
import { fx, ONE } from '../../../src/core/fixed.js';
import { cellAnchorNode, Simulation } from '../../../src/index.js';
import { combatSystem } from '../../../src/systems/index.js';
import { ACCEL_TICKS, MOVE_SPEED_PER_TICK, movementSystem } from '../../../src/systems/movement/movement.js';
import { MILITARY_MODE } from '../../../src/systems/readviews/index.js';
import { testContent } from '../../fixtures/content.js';
import { combatant, ctxOf, grassMap, P0, P1, tileOf } from './support.js';

describe('FLEE — civilians run from danger', () => {
  it('stamps Fleeing and heads AWAY from the nearest threat', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const civ = combatant(sim, 20, 0, P0, MILITARY_MODE.FLEE);
    combatant(sim, 25, 0, P1, MILITARY_MODE.IGNORE); // a stationary threat to the RIGHT

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(civ, Fleeing)).toBe(true);
    const goal = sim.world.get(civ, MoveGoal).cell;
    const goalX = sim.terrain?.coordsOf(goal).x ?? Number.NaN;
    expect(goalX).toBeLessThan(cellAnchorNode(20, 0).hx); // running LEFT, away from the threat at node x=50
  });

  it('a fleeing unit gains distance from a stationary threat', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const civ = combatant(sim, 20, 0, P0, MILITARY_MODE.FLEE);
    const threat = combatant(sim, 25, 0, P1, MILITARY_MODE.IGNORE); // stays put (IGNORE)
    const start = Math.abs(tileOf(sim, civ).x - tileOf(sim, threat).x);
    sim.run(40);
    const end = Math.abs(tileOf(sim, civ).x - tileOf(sim, threat).x);
    expect(end).toBeGreaterThan(start);
  });

  it('resumes work after the threat is gone for the cool-down', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const civ = combatant(sim, 20, 0, P0, MILITARY_MODE.FLEE);
    const threat = combatant(sim, 25, 0, P1, MILITARY_MODE.IGNORE);
    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(civ, Fleeing)).toBe(true);
    sim.world.destroy(threat); // the threat vanishes
    sim.run(60); // > the flee cool-down
    expect(sim.world.has(civ, Fleeing)).toBe(false); // returned to calm
  });

  it('a collapsing need overrides the flee (a starving settler yields to eat/sleep)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const civ = combatant(sim, 20, 0, P0, MILITARY_MODE.FLEE);
    combatant(sim, 25, 0, P1, MILITARY_MODE.IGNORE); // a lasting threat in sight
    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(civ, Fleeing)).toBe(true); // fleeing at first
    sim.world.get(civ, Settler).hunger = ONE; // pin hunger at ONE (collapse)
    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(civ, Fleeing)).toBe(false); // yielded to the need despite the threat
  });

  it('a need collapsing DURING the cool-down yields at once (does not idle out the full cool-down)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const civ = combatant(sim, 20, 0, P0, MILITARY_MODE.FLEE);
    const threat = combatant(sim, 25, 0, P1, MILITARY_MODE.IGNORE);
    combatSystem(sim.world, ctxOf(sim));
    sim.world.destroy(threat); // threat gone → the cool-down begins
    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(civ, Fleeing)).toBe(true); // still cooling down (no collapse yet)
    sim.world.get(civ, Settler).hunger = ONE; // collapse mid-cool-down
    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(civ, Fleeing)).toBe(false); // shed at once, not after FLEE_COOLDOWN_TICKS
  });
});

describe('FLEE pace — a Fleeing unit moves at its normal pace (no sprint exists)', () => {
  it('a Fleeing path-follower cruises at the same walk pace as a calm one', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 1) });
    const walker = sim.world.create();
    sim.world.add(walker, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(walker, PathFollow, {
      waypoints: [{ x: fx.fromInt(5), y: fx.fromInt(0) }],
      index: 0,
      speed: fx.fromInt(0),
      hx: fx.fromInt(0),
      hy: fx.fromInt(0),
    });
    const runner = sim.world.create();
    sim.world.add(runner, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(runner, PathFollow, {
      waypoints: [{ x: fx.fromInt(5), y: fx.fromInt(0) }],
      index: 0,
      speed: fx.fromInt(0),
      hx: fx.fromInt(0),
      hy: fx.fromInt(0),
    });
    sim.world.add(runner, Fleeing, { repathAt: 0, calmUntil: null });

    // Both start from rest and ramp up over ACCEL_TICKS toward the ONE universal gait — Fleeing
    // grants no speed boost. Warm past the ramp, then compare one cruise tick: on an E/W leg the
    // step is bit-exact the gait, identical for both.
    for (let i = 0; i <= ACCEL_TICKS; i++) movementSystem(sim.world, ctxOf(sim));
    const walkerBefore = sim.world.get(walker, Position).x;
    const runnerBefore = sim.world.get(runner, Position).x;
    expect(runnerBefore).toBe(walkerBefore); // step-for-step identical through the ramp
    movementSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(walker, Position).x).toBe(fx.add(walkerBefore, MOVE_SPEED_PER_TICK));
    expect(sim.world.get(runner, Position).x).toBe(fx.add(runnerBefore, MOVE_SPEED_PER_TICK));
  });

  it('a flee re-aim keeps the live route — the gait never resets mid-flight', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const civ = combatant(sim, 20, 0, P0, MILITARY_MODE.FLEE);
    combatant(sim, 25, 0, P1, MILITARY_MODE.IGNORE); // a lasting stationary threat
    sim.run(8); // stamp Fleeing, route the first away-goal, finish the ACCEL_TICKS ramp
    // Two full re-aim cycles (FLEE_REPATH_CADENCE = 6): the redirect keeps the PathFollow, so the
    // fleer holds cruise pace through every re-aim instead of stalling to rest and re-ramping —
    // the constant-pace rule holds mid-flight too.
    for (let i = 0; i < 12; i++) {
      sim.step();
      expect(sim.world.tryGet(civ, PathFollow)?.speed).toBe(MOVE_SPEED_PER_TICK);
    }
  });
});
