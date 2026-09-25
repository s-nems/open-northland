import { describe, expect, it } from 'vitest';
import {
  AttackOrder,
  Engagement,
  Health,
  Owner,
  Palisade,
  PathFollow,
  PlayerOrder,
  Position,
  Stance,
} from '../../src/components/index.js';
import {
  type Entity,
  nodeOfPosition,
  positionOfNode,
  type ScriptLandscapeType,
  Simulation,
} from '../../src/index.js';
import { hexagonRing, hexDistance } from '../../src/nav/halfcell.js';
import { findPath } from '../../src/nav/pathfinding/index.js';
import { dynamicBlockOverlay } from '../../src/systems/footprint/index.js';
import { attackMoveUnit, attackUnit, moveUnit } from '../../src/systems/orders/index.js';
import { palisadeBarring } from '../../src/systems/palisades/breach.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { fighterAt } from '../conflict/melee-engagement/support.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

const VIKING = 1;
const WOODCUTTER = 1;
/** The fixture's bow-armed job: a shooter's near reach keeps it off the wall. */
const HUNTER = 15;
const P0 = 0;
const P1 = 1;

const WALL: ScriptLandscapeType = {
  typeId: 691,
  walk: [{ dx: 0, dy: 0 }],
  build: [{ dx: 0, dy: 0 }],
  groups: [],
  wall: {
    logicType: 82,
    maxHitpoints: 100,
    repairPerStrike: 3,
    construction: [{ goodType: 5, amount: 1 }],
  },
};

const GATE_SPAN = [-2, -1, 0, 1, 2].map((dx) => ({ dx, dy: 0 }));

const CLOSED_GATE: ScriptLandscapeType = {
  typeId: 696,
  walk: GATE_SPAN,
  build: GATE_SPAN,
  groups: [],
  wall: {
    logicType: 83,
    maxHitpoints: 100,
    repairPerStrike: 1,
    construction: [{ goodType: 5, amount: 1 }],
    gate: { open: false, counterpartGfxIndex: 700 },
  },
};

const OPEN_GATE: ScriptLandscapeType = {
  typeId: 700,
  walk: [
    { dx: -2, dy: 0 },
    { dx: 2, dy: 0 },
  ],
  build: GATE_SPAN,
  groups: [],
  wall: {
    logicType: 84,
    maxHitpoints: 100,
    repairPerStrike: 1,
    construction: [{ goodType: 5, amount: 1 }],
    gate: { open: true, counterpartGfxIndex: 696 },
  },
};

const WIDTH = 24;
const HEIGHT = 20;
/** The half-row the wall line runs along, splitting the map into a north and a south side. */
const WALL_ROW = 10;
const GATE_X = 12;
const NORTH = { hx: GATE_X, hy: 2 };
const SOUTH = { hx: GATE_X, hy: 18 };

function fresh(): Simulation {
  const base = grassNodeMap(WIDTH, HEIGHT);
  return new Simulation({
    seed: 1,
    content: testContent(),
    map: { ...base, landscapes: { types: [WALL, CLOSED_GATE, OPEN_GATE], placements: [] } },
  });
}

/** A finished wall row across the whole map, owned by `owner`, with an open gate at {@link GATE_X}. */
function wallRow(sim: Simulation, owner: number): Entity {
  for (let hx = 0; hx < WIDTH; hx++) {
    if (Math.abs(hx - GATE_X) <= 2) continue;
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL.typeId,
      x: hx,
      y: WALL_ROW,
      tribe: VIKING,
      owner,
    });
  }
  sim.enqueueSetup({
    kind: 'placePalisade',
    gfxIndex: OPEN_GATE.typeId,
    x: GATE_X,
    y: WALL_ROW,
    tribe: VIKING,
    owner,
  });
  sim.step();
  const gate = [...sim.world.query(Palisade)].find((e) => sim.world.get(e, Palisade).gate !== null);
  if (gate === undefined) throw new Error('expected the gate');
  return gate;
}

/** A finished row of single-post walls on half-row `hy`, owned by `owner`, leaving the `gap` columns open. */
function postRow(sim: Simulation, hy: number, owner: number, gap: readonly number[] = []): void {
  for (let hx = 0; hx < WIDTH; hx++) {
    if (gap.includes(hx)) continue;
    sim.enqueueSetup({ kind: 'placePalisade', gfxIndex: WALL.typeId, x: hx, y: hy, tribe: VIKING, owner });
  }
  sim.step();
}

function fighter(sim: Simulation, at: { hx: number; hy: number }, owner: number): Entity {
  const e = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner });
  sim.world.add(e, Position, positionOfNode(at.hx, at.hy));
  return e;
}

function nodeRow(sim: Simulation, e: Entity): { hx: number; hy: number } {
  const p = sim.world.get(e, Position);
  return nodeOfPosition(p.x, p.y);
}

function sealed(sim: Simulation, from = NORTH, to = SOUTH): boolean {
  const terrain = mapped(sim);
  const blocked = dynamicBlockOverlay(sim.world, ctxOf(sim), terrain);
  return findPath(terrain, terrain.nodeAt(from.hx, from.hy), terrain.nodeAt(to.hx, to.hy), blocked) === null;
}

function mapped(sim: Simulation) {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('expected a mapped simulation');
  return terrain;
}

function barring(sim: Simulation, e: Entity, goal: { hx: number; hy: number }): Entity | null {
  const terrain = mapped(sim);
  const at = nodeRow(sim, e);
  const breach = palisadeBarring(
    sim.world,
    ctxOf(sim),
    terrain,
    e,
    terrain.nodeAt(at.hx, at.hy),
    terrain.nodeAt(goal.hx, goal.hy),
  );
  return breach?.wall ?? null;
}

describe('walls that start blocking a route', () => {
  it('stops a walker a gate shuts in front of, instead of letting it through', () => {
    const sim = fresh();
    const gate = wallRow(sim, P0);
    expect(sealed(sim)).toBe(false);
    const walker = fighter(sim, NORTH, P0);
    moveUnit(sim.world, ctxOf(sim), { kind: 'moveUnit', entity: walker, x: SOUTH.hx, y: SOUTH.hy });

    // Walk it up to two half-rows short of the gate, where closing is still allowed.
    for (let tick = 0; tick < 400 && nodeRow(sim, walker).hy < WALL_ROW - 2; tick++) sim.step();
    expect(nodeRow(sim, walker).hy).toBe(WALL_ROW - 2);
    sim.enqueueSetup({ kind: 'setPalisadeGate', palisade: gate, open: false });
    sim.step();
    expect(sim.world.get(gate, Palisade).gate?.open).toBe(false);
    expect(sealed(sim)).toBe(true);

    for (let tick = 0; tick < 200; tick++) {
      sim.step();
      expect(nodeRow(sim, walker).hy).toBeLessThan(WALL_ROW);
    }
    // No other way through, so the order ends on this side.
    expect(sim.world.has(walker, PathFollow)).toBe(false);
    expect(sim.world.has(walker, PlayerOrder)).toBe(false);
  });

  it('stops walkers a finished segment would otherwise let slip diagonally through the last gap', () => {
    const sim = fresh();
    // An odd half-row, where the routes through a one-post gap step diagonally past its neighbours.
    const row = 11;
    postRow(sim, row, P0, [GATE_X]);
    const trips = [
      { from: { hx: 4, hy: 2 }, to: { hx: 20, hy: 18 } },
      { from: { hx: 6, hy: 2 }, to: { hx: 18, hy: 18 } },
      { from: { hx: 16, hy: 2 }, to: { hx: 8, hy: 18 } },
    ];
    const walkers = trips.map(({ from, to }) => {
      const walker = fighter(sim, from, P0);
      moveUnit(sim.world, ctxOf(sim), { kind: 'moveUnit', entity: walker, x: to.hx, y: to.hy });
      return walker;
    });
    for (let tick = 0; tick < 400 && walkers.some((w) => nodeRow(sim, w).hy < row - 3); tick++) sim.step();

    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL.typeId,
      x: GATE_X,
      y: row,
      tribe: VIKING,
      owner: P0,
    });
    sim.step();
    expect(sealed(sim)).toBe(true);
    for (let tick = 0; tick < 300; tick++) {
      sim.step();
      for (const walker of walkers) expect(nodeRow(sim, walker).hy).toBeLessThan(row);
    }
  });
});

describe('a wall line that turns', () => {
  const CENTRE = { hx: GATE_X, hy: WALL_ROW };
  const OUTSIDE = { hx: WIDTH - 2, hy: WALL_ROW };

  function ring(sim: Simulation, owner: number): void {
    for (const { point } of hexagonRing(CENTRE, 4)) {
      sim.enqueueSetup({
        kind: 'placePalisade',
        gfxIndex: WALL.typeId,
        x: point.hx,
        y: point.hy,
        tribe: VIKING,
        owner,
      });
    }
    sim.step();
  }

  it('holds the walkers it rings, slanted joints included', () => {
    const sim = fresh();
    ring(sim, P0);
    expect(sealed(sim, CENTRE, OUTSIDE)).toBe(true);
    const walker = fighter(sim, CENTRE, P0);
    moveUnit(sim.world, ctxOf(sim), { kind: 'moveUnit', entity: walker, x: OUTSIDE.hx, y: OUTSIDE.hy });
    for (let tick = 0; tick < 300; tick++) {
      sim.step();
      expect(Math.abs(nodeRow(sim, walker).hx - CENTRE.hx)).toBeLessThan(4);
    }
  });

  it('is still breached through one of its posts', () => {
    const sim = fresh();
    ring(sim, P1);
    const raider = fighter(sim, OUTSIDE, P0);
    const wall = barring(sim, raider, CENTRE);
    if (wall === null) throw new Error('expected a wall to break');
    sim.world.mut(wall, Health).hitpoints = 0;
    sim.step();
    expect(sealed(sim, OUTSIDE, CENTRE)).toBe(false);
  });

  it('deals a squad breaking in its own nodes outside the ring, and each swings from its own', () => {
    const sim = fresh();
    ring(sim, P1);
    const squad = [4, 5, 6, 7].map((hy) => fighter(sim, { hx: 2, hy: WALL_ROW - 6 + 2 * (hy - 4) }, P0));
    for (const raider of squad) {
      attackMoveUnit(sim.world, ctxOf(sim), {
        kind: 'attackMoveUnit',
        entity: raider,
        x: CENTRE.hx,
        y: CENTRE.hy,
      });
    }
    for (let tick = 0; tick < 20 && !squad.every((r) => sim.world.has(r, AttackOrder)); tick++) sim.step();
    const stands = squad.map((raider) => sim.world.get(raider, AttackOrder).breach?.stand ?? null);
    expect(new Set(stands).size).toBe(squad.length);
    sim.run(300);
    const terrain = mapped(sim);
    for (const [at, raider] of squad.entries()) {
      const here = nodeRow(sim, raider);
      expect(terrain.nodeAt(here.hx, here.hy)).toBe(stands[at]);
      expect(hexDistance(here, CENTRE)).toBeGreaterThan(4);
    }
  });

  it('deals a shooter no node beside the wall', () => {
    const sim = fresh();
    ring(sim, P1);
    const archer = fighterAt(sim, 0, 0, VIKING, HUNTER, { owner: P0 });
    sim.world.add(archer, Position, positionOfNode(OUTSIDE.hx, OUTSIDE.hy));
    const terrain = mapped(sim);
    const breach = palisadeBarring(
      sim.world,
      ctxOf(sim),
      terrain,
      archer,
      terrain.nodeAt(OUTSIDE.hx, OUTSIDE.hy),
      terrain.nodeAt(CENTRE.hx, CENTRE.hy),
    );
    expect(breach?.stand).toBeNull();
  });

  it('never seals the passage of an open gate it meets', () => {
    const sim = fresh();
    // An odd half-row, where a post a half-row under the gate's end joins it slanting across the passage.
    const row = WALL_ROW - 1;
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: OPEN_GATE.typeId,
      x: GATE_X,
      y: row,
      tribe: VIKING,
      owner: P0,
    });
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL.typeId,
      x: GATE_X - 1,
      y: row + 1,
      tribe: VIKING,
      owner: P0,
    });
    sim.step();
    const terrain = mapped(sim);
    const blocked = dynamicBlockOverlay(sim.world, ctxOf(sim), terrain);
    expect(blocked.has(terrain.nodeAt(GATE_X - 1, row))).toBe(false);
    expect(blocked.has(terrain.nodeAt(GATE_X - 2, row + 1))).toBe(true);
  });
});

describe('walls as targets', () => {
  it("are never picked on a fighter's own, however close", () => {
    const sim = fresh();
    postRow(sim, WALL_ROW, P1);
    const guard = fighter(sim, { hx: GATE_X, hy: WALL_ROW - 1 }, P0);
    sim.run(60);
    expect(sim.world.has(guard, Engagement)).toBe(false);
    expect(sim.world.has(guard, AttackOrder)).toBe(false);
  });

  it('are taken on by a player attack order', () => {
    const sim = fresh();
    postRow(sim, WALL_ROW, P1);
    const wall = [...sim.world.query(Palisade)][0];
    if (wall === undefined) throw new Error('expected a wall');
    const soldier = fighter(sim, NORTH, P0);
    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: soldier, target: wall });
    expect(sim.world.get(soldier, AttackOrder).target).toBe(wall);
  });

  it('bar the way only when they are what blocks it', () => {
    const sim = fresh();
    postRow(sim, WALL_ROW, P1, [0, 1, 2]);
    const raider = fighter(sim, NORTH, P0);
    expect(sealed(sim)).toBe(false);
    expect(barring(sim, raider, SOUTH)).toBeNull();
  });

  it('bar a way that crosses their line diagonally between two posts', () => {
    const sim = fresh();
    postRow(sim, 11, P1);
    const raider = fighter(sim, { hx: 4, hy: 2 }, P0);
    for (const goal of [
      { hx: 10, hy: 18 },
      { hx: 12, hy: 18 },
      { hx: 14, hy: 18 },
    ]) {
      const wall = barring(sim, raider, goal);
      if (wall === null) throw new Error(`expected a wall to bar the way to ${goal.hx},${goal.hy}`);
      expect(nodeRow(sim, wall).hy).toBe(11);
    }
  });
});

describe('an attack-move against a sealed palisade', () => {
  it('attacks the wall that bars the way and marches on once it falls', () => {
    const sim = fresh();
    const gate = wallRow(sim, P1);
    sim.enqueueSetup({ kind: 'setPalisadeGate', palisade: gate, open: false });
    sim.step();
    expect(sealed(sim)).toBe(true);
    const raider = fighter(sim, NORTH, P0);
    attackMoveUnit(sim.world, ctxOf(sim), {
      kind: 'attackMoveUnit',
      entity: raider,
      x: SOUTH.hx,
      y: SOUTH.hy,
    });

    for (let tick = 0; tick < 20 && !sim.world.has(raider, AttackOrder); tick++) sim.step();
    const target = sim.world.tryGet(raider, AttackOrder)?.target;
    if (target === undefined) throw new Error('expected the raider to go for the wall');
    expect(sim.world.has(target, Palisade)).toBe(true);
    expect(nodeRow(sim, target).hy).toBe(WALL_ROW);
    expect(sim.world.get(raider, PlayerOrder).attackMove?.goal).toBeDefined();

    // The fixture weapons do not dent a wall, so the breach is made for them.
    sim.world.mut(target, Health).hitpoints = 0;
    for (let tick = 0; tick < 600 && nodeRow(sim, raider).hy < SOUTH.hy; tick++) sim.step();
    expect(nodeRow(sim, raider)).toEqual(SOUTH);
  });

  it('walks a whole squad through the first post to fall', () => {
    const sim = fresh();
    const gate = wallRow(sim, P1);
    sim.enqueueSetup({ kind: 'setPalisadeGate', palisade: gate, open: false });
    sim.step();
    const squad = [6, 10, 14, 18].map((hx) => fighter(sim, { hx, hy: 2 }, P0));
    for (const raider of squad) {
      attackMoveUnit(sim.world, ctxOf(sim), {
        kind: 'attackMoveUnit',
        entity: raider,
        x: SOUTH.hx,
        y: SOUTH.hy,
      });
    }
    for (let tick = 0; tick < 20 && !squad.every((r) => sim.world.has(r, AttackOrder)); tick++) sim.step();
    const first = squad[0] === undefined ? undefined : sim.world.tryGet(squad[0], AttackOrder)?.target;
    if (first === undefined) throw new Error('expected the squad to go for the wall');
    const walls = [...sim.world.query(Palisade)].length;

    sim.world.mut(first, Health).hitpoints = 0;
    for (let tick = 0; tick < 900 && squad.some((r) => nodeRow(sim, r).hy <= WALL_ROW); tick++) sim.step();
    for (const raider of squad) expect(nodeRow(sim, raider).hy).toBeGreaterThan(WALL_ROW);
    expect([...sim.world.query(Palisade)]).toHaveLength(walls - 1);
  });

  it('spreads a squad along the line, one breaker to each free node on the near side', () => {
    const sim = fresh();
    postRow(sim, WALL_ROW, P1);
    const squad = [10, 11, 12, 13, 14, 15].map((hx) => fighter(sim, { hx, hy: 4 }, P0));
    for (const raider of squad) {
      attackMoveUnit(sim.world, ctxOf(sim), {
        kind: 'attackMoveUnit',
        entity: raider,
        x: SOUTH.hx,
        y: SOUTH.hy,
      });
    }
    for (let tick = 0; tick < 20 && !squad.every((r) => sim.world.has(r, AttackOrder)); tick++) sim.step();
    const orders = squad.map((raider) => sim.world.get(raider, AttackOrder));
    const columns = orders.map((order) => nodeRow(sim, order.target).hx);
    // A straight row offers each post one node on the near side, so six breakers take six posts in a run.
    expect(new Set(columns).size).toBe(squad.length);
    expect(Math.max(...columns) - Math.min(...columns)).toBe(squad.length - 1);

    // The fixture weapons do not dent a wall, so every breaker ends up swinging from its own node.
    sim.run(200);
    const terrain = mapped(sim);
    for (const [at, raider] of squad.entries()) {
      const stand = orders[at]?.breach?.stand;
      if (stand === undefined || stand === null) throw new Error('expected a dealt node');
      const here = nodeRow(sim, raider);
      expect(terrain.nodeAt(here.hx, here.hy)).toBe(stand);
      expect(here.hy).toBe(WALL_ROW - 1);
    }
  });

  it('turns an ordered attack on a walled-in enemy into a breach, then back onto the enemy', () => {
    const sim = fresh();
    const gate = wallRow(sim, P1);
    sim.enqueueSetup({ kind: 'setPalisadeGate', palisade: gate, open: false });
    sim.step();
    const enemy = fighter(sim, SOUTH, P1);
    const soldier = fighter(sim, NORTH, P0);
    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: soldier, target: enemy });
    for (let tick = 0; tick < 20 && sim.world.get(soldier, AttackOrder).breach === undefined; tick++)
      sim.step();
    const order = sim.world.get(soldier, AttackOrder);
    expect(order.breach?.resume).toBe(enemy);
    expect(sim.world.has(order.target, Palisade)).toBe(true);

    sim.world.mut(order.target, Health).hitpoints = 0;
    sim.step();
    expect(sim.world.get(soldier, AttackOrder)).toEqual({ target: enemy });
  });

  it('gives up on a wall it may not attack, as on any other unreachable spot', () => {
    const sim = fresh();
    const gate = wallRow(sim, P0);
    sim.enqueueSetup({ kind: 'setPalisadeGate', palisade: gate, open: false });
    sim.step();
    const own = fighter(sim, NORTH, P0);
    attackMoveUnit(sim.world, ctxOf(sim), { kind: 'attackMoveUnit', entity: own, x: SOUTH.hx, y: SOUTH.hy });
    sim.run(20);
    expect(sim.world.has(own, AttackOrder)).toBe(false);
    expect(sim.world.has(own, PlayerOrder)).toBe(false);
  });
});

describe('a fighter walled in with its enemy in sight', () => {
  const SHOOTER = { hx: GATE_X, hy: WALL_ROW - 3 };
  const PRISONER = { hx: GATE_X, hy: WALL_ROW + 3 };

  /** The prisoner's breach order within `ticks`, or undefined when it never goes for a wall. */
  function breachOf(sim: Simulation, prisoner: Entity, ticks = 200) {
    for (let tick = 0; tick < ticks; tick++) {
      sim.step();
      const order = sim.world.tryGet(prisoner, AttackOrder);
      if (order?.breach !== undefined) return order;
    }
    return undefined;
  }

  function walledIn(wallOwner: number | null) {
    const sim = fresh();
    const gate = wallRow(sim, wallOwner ?? P0);
    if (wallOwner === null) for (const wall of sim.world.query(Palisade)) sim.world.remove(wall, Owner);
    sim.enqueueSetup({ kind: 'setPalisadeGate', palisade: gate, open: false });
    sim.step();
    const shooter = fighter(sim, SHOOTER, P0);
    const prisoner = fighter(sim, PRISONER, P1);
    return { sim, shooter, prisoner };
  }

  it('breaks an enemy wall to get at the enemy, then goes for the enemy', () => {
    const { sim, shooter, prisoner } = walledIn(P0);
    const order = breachOf(sim, prisoner);
    if (order === undefined) throw new Error('expected the prisoner to go for the wall');
    expect(sim.world.has(order.target, Palisade)).toBe(true);
    expect(order.breach?.resume).toBeNull();

    // The fixture weapons do not dent a wall, so the breach is made for them.
    sim.world.mut(order.target, Health).hitpoints = 0;
    sim.step();
    expect(sim.world.has(prisoner, AttackOrder)).toBe(false);
    const hurt = (): boolean => sim.world.get(shooter, Health).hitpoints < sim.world.get(shooter, Health).max;
    for (let tick = 0; tick < 600 && !hurt(); tick++) sim.step();
    expect(nodeRow(sim, prisoner).hy).toBeLessThan(WALL_ROW);
    expect(hurt()).toBe(true);
  });

  it("leaves a map's ownerless wall standing", () => {
    const { sim, prisoner } = walledIn(null);
    expect(breachOf(sim, prisoner)).toBeUndefined();
  });

  it('holds its post on DEFEND', () => {
    const { sim, prisoner } = walledIn(P0);
    sim.world.mut(prisoner, Stance).mode = MILITARY_MODE.DEFEND;
    expect(breachOf(sim, prisoner)).toBeUndefined();
  });
});
