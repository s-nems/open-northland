import { beforeEach, describe, expect, it } from 'vitest';
import {
  Age,
  AttackOrder,
  CurrentAtomic,
  Engagement,
  Fleeing,
  Health,
  MoveGoal,
  Owner,
  PathFollow,
  PathRequest,
  PlayerOrder,
  Position,
  Resource,
  Settler,
  Stance,
} from '../../src/components/index.js';
import { type Fixed, fx, ONE } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  cellAnchorNode,
  halfCellMapFromCells,
  positionOfNode,
  Simulation,
  type TerrainMap,
} from '../../src/index.js';
import { spawnSettler } from '../../src/systems/conflict/spawn.js';
import {
  combatSystem,
  DEFEND_LEASH_NODES,
  DEFEND_RADIUS_NODES,
  type SystemContext,
} from '../../src/systems/index.js';
import {
  ACCEL_TICKS,
  MOVE_SPEED_PER_TICK,
  movementSystem,
  RUN_SPEED_MULTIPLIER,
} from '../../src/systems/movement/movement.js';
import { attackUnit, setJob, setStance } from '../../src/systems/orders/index.js';
import { defaultStanceForJob, MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * The four **military stances** (`MILITARY_MODE`) as a per-unit auto-engagement mode, plus the civilian
 * **flee** drive. This file pins the stance layer on top of the engagement half (melee-engagement.test.ts):
 * the job-based defaults, the `setStance` command, the ATTACK/DEFEND/IGNORE/FLEE gates, and the
 * order-over-stance precedence — all deterministic, no RNG.
 *
 * The fixture's `test_axe` (viking tribe 1, job 1) has band `[1, 2]`, damage 50 vs unarmored; job 1
 * (woodcutter) is a CIVILIAN, so it defaults to FLEE — the tests give a combatant an explicit ATTACK/
 * DEFEND/IGNORE stance where they mean it to fight.
 */

const GRASS = 0;
const VIKING = 1;
const WOODCUTTER = 1; // has the axe weapon; a civilian job (default FLEE)
const P0 = 0;
const P1 = 1;

beforeEach(() => {
  for (const c of [
    Position,
    Settler,
    Health,
    Owner,
    Stance,
    Fleeing,
    Engagement,
    AttackOrder,
    CurrentAtomic,
    MoveGoal,
    PathFollow,
    PathRequest,
    PlayerOrder,
    Resource,
    Age,
  ]) {
    c.store.clear();
  }
});

const WOOD = 1; // the fixture's wood good (harvest atomic 24), what a woodcutter (job 1) gathers
const HARVEST_ATOMIC = 24;

function grassMap(width: number, height: number): TerrainMap {
  return halfCellMapFromCells({ width, height, typeIds: new Array(width * height).fill(GRASS) });
}

function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: sim.tick,
    events: sim.events,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

/** An owned combatant with an explicit stance at visual cell (x,y) (a direct spawn — full control over
 *  the mode). */
function combatant(
  sim: Simulation,
  x: number,
  y: number,
  owner: number,
  mode: number,
  opts: { hitpoints?: number; jobType?: number } = {},
): Entity {
  return combatantAtPosition(sim, { x: fx.fromInt(x), y: fx.fromInt(y) }, owner, mode, opts);
}

/** An owned combatant standing exactly on half-cell node (hx, hy) — reach geometry a whole cell
 *  (2 nodes on a row) cannot express, e.g. an ODD node distance from a cell-anchored unit. */
function combatantAtNode(
  sim: Simulation,
  hx: number,
  hy: number,
  owner: number,
  mode: number,
  opts: { hitpoints?: number; jobType?: number } = {},
): Entity {
  return combatantAtPosition(sim, positionOfNode(hx, hy), owner, mode, opts);
}

function combatantAtPosition(
  sim: Simulation,
  position: { x: Fixed; y: Fixed },
  owner: number,
  mode: number,
  opts: { hitpoints?: number; jobType?: number } = {},
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: position.x, y: position.y });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: opts.jobType ?? WOODCUTTER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  sim.world.add(e, Health, { hitpoints: opts.hitpoints ?? 2000, max: opts.hitpoints ?? 2000 });
  sim.world.add(e, Owner, { player: owner });
  sim.world.add(e, Stance, { mode, anchorCell: null });
  return e;
}

/** The nav node id of visual cell (x,y)'s ANCHOR node — where a unit minted at integer cell coords
 *  stands on the half-cell lattice. */
function cell(sim: Simulation, x: number, y: number): number {
  const t = sim.terrain;
  if (t === undefined) throw new Error('no terrain');
  const n = cellAnchorNode(x, y);
  return t.nodeAtClamped(n.hx, n.hy);
}

function tileOf(sim: Simulation, e: Entity): { x: number; y: number } {
  const p = sim.world.get(e, Position);
  return { x: fx.toInt(p.x), y: fx.toInt(p.y) };
}

// ---------------------------------------------------------------------------------------------------

describe('stance defaults — the job → military-mode lookup', () => {
  it('classifies the roster: soldiers/heroes ATTACK, scout/hunter IGNORE, everyone else FLEE', () => {
    expect(defaultStanceForJob(31)).toBe(MILITARY_MODE.ATTACK); // first soldier
    expect(defaultStanceForJob(41)).toBe(MILITARY_MODE.ATTACK); // last soldier
    expect(defaultStanceForJob(45)).toBe(MILITARY_MODE.ATTACK); // a hero
    expect(defaultStanceForJob(27)).toBe(MILITARY_MODE.IGNORE); // scout
    expect(defaultStanceForJob(15)).toBe(MILITARY_MODE.IGNORE); // hunter (toward humans)
    expect(defaultStanceForJob(1)).toBe(MILITARY_MODE.FLEE); // woodcutter (civilian)
    expect(defaultStanceForJob(0)).toBe(MILITARY_MODE.FLEE); // idle
    expect(defaultStanceForJob(null)).toBe(MILITARY_MODE.FLEE); // jobless / child
  });

  it('stamps the job default on an OWNED settler at spawn — and NONE on an unowned one', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const ctx = ctxOf(sim);
    spawnSettler(sim.world, ctx, {
      kind: 'spawnSettler',
      jobType: WOODCUTTER,
      x: 0,
      y: 0,
      tribe: VIKING,
      owner: P0,
    });
    spawnSettler(sim.world, ctx, { kind: 'spawnSettler', jobType: WOODCUTTER, x: 1, y: 0, tribe: VIKING });
    const [owned, unowned] = [...sim.world.query(Settler)];
    expect(sim.world.get(owned as Entity, Stance).mode).toBe(MILITARY_MODE.FLEE); // owned civilian → FLEE
    expect(sim.world.has(unowned as Entity, Stance)).toBe(false); // unowned carries no Stance (golden-safe)
  });

  it('re-stamps the default on a profession change', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = combatant(sim, 0, 0, P0, MILITARY_MODE.ATTACK); // starts ATTACK
    setJob(sim.world, ctxOf(sim), { kind: 'setJob', entity: e, jobType: WOODCUTTER });
    expect(sim.world.get(e, Stance).mode).toBe(MILITARY_MODE.FLEE); // woodcutter default
  });
});

describe('setStance command', () => {
  it('sets an owned unit’s mode; a DEFEND stance captures the unit’s tile as the anchor', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 4) });
    const e = combatant(sim, 3, 2, P0, MILITARY_MODE.ATTACK);
    setStance(sim.world, ctxOf(sim), { kind: 'setStance', entity: e, mode: MILITARY_MODE.DEFEND });
    const s = sim.world.get(e, Stance);
    expect(s.mode).toBe(MILITARY_MODE.DEFEND);
    expect(s.anchorCell).toBe(cell(sim, 3, 2)); // anchored where it stood
  });

  it('clears the anchor when the mode is not DEFEND', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 4) });
    const e = combatant(sim, 3, 2, P0, MILITARY_MODE.DEFEND);
    sim.world.get(e, Stance).anchorCell = cell(sim, 3, 2);
    setStance(sim.world, ctxOf(sim), { kind: 'setStance', entity: e, mode: MILITARY_MODE.ATTACK });
    expect(sim.world.get(e, Stance).anchorCell).toBeNull();
  });

  it('skips a neutral (unowned) unit and an out-of-range mode (recoverable bad input)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    // Unowned: no Owner → the command is skipped (no Stance ever added).
    const neutral = sim.world.create();
    sim.world.add(neutral, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(neutral, Settler, {
      tribe: VIKING,
      jobType: WOODCUTTER,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map(),
    });
    setStance(sim.world, ctxOf(sim), { kind: 'setStance', entity: neutral, mode: MILITARY_MODE.ATTACK });
    expect(sim.world.has(neutral, Stance)).toBe(false);
    // Out-of-range mode on an owned unit: the mode is unchanged.
    const owned = combatant(sim, 1, 0, P0, MILITARY_MODE.IGNORE);
    setStance(sim.world, ctxOf(sim), { kind: 'setStance', entity: owned, mode: 7 });
    expect(sim.world.get(owned, Stance).mode).toBe(MILITARY_MODE.IGNORE);
  });
});

describe('IGNORE — never auto-engage, but an explicit order still fights', () => {
  it('an IGNORE unit does NOT swing at an adjacent enemy', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const scout = combatant(sim, 0, 0, P0, MILITARY_MODE.IGNORE);
    combatant(sim, 1, 0, P1, MILITARY_MODE.ATTACK); // enemy adjacent, in reach
    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(scout, CurrentAtomic)).toBe(false); // it ignored the enemy
    expect(sim.world.has(scout, Engagement)).toBe(false);
  });

  it('an explicit attackUnit order overrides the IGNORE stance (order-over-stance)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const scout = combatant(sim, 0, 0, P0, MILITARY_MODE.IGNORE);
    const enemy = combatant(sim, 1, 0, P1, MILITARY_MODE.ATTACK);
    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: scout, target: enemy });
    combatSystem(sim.world, ctxOf(sim));
    // The order makes the IGNORE unit strike the ordered target.
    expect(sim.world.get(scout, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: enemy });
  });

  it('when the ordered target dies, an IGNORE unit reverts to ignoring — it does NOT auto-engage a bystander', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const scout = combatant(sim, 0, 0, P0, MILITARY_MODE.IGNORE);
    const focus = combatant(sim, 1, 0, P1, MILITARY_MODE.IGNORE); // the ordered target (2 nodes away)
    combatantAtNode(sim, 1, 0, P1, MILITARY_MODE.IGNORE); // a bystander enemy 1 node away, in reach, the scout must NOT hit
    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: scout, target: focus });
    sim.world.get(focus, Health).hitpoints = 0; // the ordered target dies

    combatSystem(sim.world, ctxOf(sim));
    // The stale order is dropped and the IGNORE stance re-decides THIS tick — no swing at the bystander.
    expect(sim.world.has(scout, AttackOrder)).toBe(false);
    expect(sim.world.has(scout, CurrentAtomic)).toBe(false);
    expect(sim.world.has(scout, Engagement)).toBe(false);
  });
});

describe('stance change mid-chase', () => {
  it('switching ATTACK → IGNORE stops a chase (drops Engagement + the chase route)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const chaser = combatant(sim, 0, 0, P0, MILITARY_MODE.ATTACK);
    combatant(sim, 6, 0, P1, MILITARY_MODE.IGNORE); // 12 nodes — spotted (sight 16) but beyond reach (2) → chase

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(chaser, Engagement)).toBe(true); // it is chasing
    expect(sim.world.has(chaser, MoveGoal)).toBe(true);

    setStance(sim.world, ctxOf(sim), { kind: 'setStance', entity: chaser, mode: MILITARY_MODE.IGNORE });
    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(chaser, Engagement)).toBe(false); // IGNORE disengages
    expect(sim.world.has(chaser, MoveGoal)).toBe(false);
  });

  it('switching ATTACK → FLEE mid-chase sheds the stale Engagement (no permanent bench)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const unit = combatant(sim, 10, 0, P0, MILITARY_MODE.ATTACK);
    const enemy = combatant(sim, 16, 0, P1, MILITARY_MODE.IGNORE); // 12 nodes — spotted, beyond reach → chase

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(unit, Engagement)).toBe(true); // chasing

    setStance(sim.world, ctxOf(sim), { kind: 'setStance', entity: unit, mode: MILITARY_MODE.FLEE });
    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(unit, Engagement)).toBe(false); // the attack Engagement is shed on entering flee
    expect(sim.world.has(unit, Fleeing)).toBe(true); // now fleeing the same enemy

    // Threat gone: after the cool-down the unit fully disengages — crucially NO Engagement is left stuck
    // (the bug this guards: a leaked Engagement benches the unit forever and keeps combat awake).
    sim.world.destroy(enemy);
    sim.run(60);
    expect(sim.world.has(unit, Engagement)).toBe(false);
    expect(sim.world.has(unit, Fleeing)).toBe(false);
  });
});

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

  it('the fleeing gait outruns a walking pursuer — distance to the threat grows', () => {
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

describe('FLEE run gait — the MovementSystem runs a Fleeing unit', () => {
  it('a Fleeing path-follower cruises at RUN_SPEED_MULTIPLIER× the walk pace', () => {
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

    // Both start from rest and ramp up over ACCEL_TICKS (each toward its OWN gait — the runner's
    // ramp is proportionally steeper, so it pulls ahead from the very first tick). Warm past the
    // ramp, then compare one cruise tick: on an E/W leg the step is bit-exact the gait.
    for (let i = 0; i <= ACCEL_TICKS; i++) movementSystem(sim.world, ctxOf(sim));
    const walkerBefore = sim.world.get(walker, Position).x;
    const runnerBefore = sim.world.get(runner, Position).x;
    expect(runnerBefore).toBeGreaterThan(walkerBefore); // the runner led throughout the ramp too
    movementSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(walker, Position).x).toBe(fx.add(walkerBefore, MOVE_SPEED_PER_TICK));
    expect(sim.world.get(runner, Position).x).toBe(
      fx.add(runnerBefore, fx.mul(MOVE_SPEED_PER_TICK, fx.fromInt(RUN_SPEED_MULTIPLIER))),
    );
  });
});

describe('DEFEND — hold an anchor, don’t chase past the leash', () => {
  it('ignores an enemy OUTSIDE the defend radius (holds its post)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(30, 1) });
    const guard = combatant(sim, 10, 0, P0, MILITARY_MODE.DEFEND);
    sim.world.get(guard, Stance).anchorCell = cell(sim, 10, 0);
    // 1 node outside the radius: the anchor is node (20, 0), the enemy DEFEND_RADIUS_NODES+1 nodes east.
    combatantAtNode(sim, 20 + DEFEND_RADIUS_NODES + 1, 0, P1, MILITARY_MODE.IGNORE);

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(guard, CurrentAtomic)).toBe(false); // did not engage
    expect(sim.world.has(guard, Engagement)).toBe(false);
    expect(sim.world.has(guard, MoveGoal)).toBe(false); // stayed on its anchor
  });

  it('engages an enemy INSIDE the radius, and its chase never leaves the leash of the anchor', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(30, 1) });
    const guard = combatant(sim, 10, 0, P0, MILITARY_MODE.DEFEND);
    const anchor = cell(sim, 10, 0);
    sim.world.get(guard, Stance).anchorCell = anchor;
    // An enemy 6 nodes out: inside the radius (8), beyond reach (2) → chase, but leashed.
    const enemy = combatant(sim, 13, 0, P1, MILITARY_MODE.IGNORE);

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(guard, Engagement)).toBe(true); // engaged the in-radius enemy
    const goal = sim.world.get(guard, MoveGoal).cell;
    const g = sim.terrain?.coordsOf(goal);
    const a = sim.terrain?.coordsOf(anchor);
    const distToAnchor = Math.abs((g?.x ?? 0) - (a?.x ?? 0)) + Math.abs((g?.y ?? 0) - (a?.y ?? 0));
    expect(distToAnchor).toBeLessThanOrEqual(DEFEND_LEASH_NODES); // the chase stayed within the leash
    expect(enemy).toBeDefined();
  });

  it('over a run past a nearby enemy, the defender stays within the leash of its anchor', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const guard = combatant(sim, 10, 0, P0, MILITARY_MODE.DEFEND, { hitpoints: 100000 });
    const anchorX = 10;
    sim.world.get(guard, Stance).anchorCell = cell(sim, anchorX, 0);
    // A tough enemy that marches in (ATTACK) — it reaches the defend radius during the run, so the guard
    // engages and chases; both are far too tough to die, so the fight lasts the whole run.
    combatant(sim, 16, 0, P1, MILITARY_MODE.ATTACK, { hitpoints: 100000 });

    sim.run(120);
    const gx = tileOf(sim, guard).x;
    // The leash is a NODE Manhattan bound; a same-row cell offset is 2 nodes, so double the cell delta.
    expect(Math.abs(gx - anchorX) * 2).toBeLessThanOrEqual(DEFEND_LEASH_NODES);
  });

  it('holds its post against the economy — a militia-job guard does not wander off to work', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 1) });
    // A DEFEND unit on a CIVILIAN job (woodcutter) — without the economy-skip it would walk off to harvest.
    const guard = combatant(sim, 5, 0, P0, MILITARY_MODE.DEFEND, { jobType: WOODCUTTER });
    // A wood node it could harvest, off to the side.
    const wood = sim.world.create();
    sim.world.add(wood, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(wood, Resource, { goodType: WOOD, remaining: 100, harvestAtomic: HARVEST_ATOMIC });

    sim.run(30);
    expect(tileOf(sim, guard)).toEqual({ x: 5, y: 0 }); // stayed on its post, never walked to the wood
  });
});
