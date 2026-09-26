import { type ContentSet, parseContentSet } from '@open-northland/data';
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
  SettlerProgress,
  Stance,
} from '../../src/components/index.js';
import {
  type Entity,
  exportSaveGame,
  nodeOfPosition,
  positionOfNode,
  restoreSimulation,
  type ScriptLandscapeType,
  Simulation,
  type TerrainMap,
} from '../../src/index.js';
import { hexagonRing, hexDistance } from '../../src/nav/halfcell.js';
import { findPath } from '../../src/nav/pathfinding/index.js';
import { dynamicBlockOverlay } from '../../src/systems/footprint/index.js';
import { attackMoveUnit, attackUnit, moveUnit } from '../../src/systems/orders/index.js';
import { palisadeBarring } from '../../src/systems/palisades/breach.js';
import { fightExperienceTypeFor } from '../../src/systems/progression/experience.js';
import { ARMOR_MATERIAL, MILITARY_MODE, WEAPON_MAIN_TYPE } from '../../src/systems/readviews/index.js';
import { fighterAt } from '../conflict/melee-engagement/support.js';
import { combatContent } from '../fixtures/content/combat.js';
import { economyContent } from '../fixtures/content/economy.js';
import { TEST_MANIFEST } from '../fixtures/content/index.js';
import { societyContent } from '../fixtures/content/societies.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

const VIKING = 1;
const WOODCUTTER = 1;
/** The fixture's bow-armed job: a shooter's near reach keeps it off the wall. */
const HUNTER = 15;
/** The fixture's aggressive wild animal. */
const BEAR = 10;
const P0 = 0;
const P1 = 1;
/** The axe weapon class, whose fight bucket seasons the woodcutter's swing. */
/** The fixture axe is stamped a sword so its striker can carry a fight bucket the wall must ignore. */
const STRIKER_CLASS = WEAPON_MAIN_TYPE.SWORD;
/** Landed hits past the building-damage experience cap, which would double a blow on a house. */
const SEASONED_HITS = 100;
/** The fixture axe's far reach (map points). */
const WEAPON_REACH = 2;
/** Building-column damage that takes one valency off a wall per blow. */
const HOUSE_DAMAGE = 150;

const WALL: ScriptLandscapeType = {
  typeId: 691,
  walk: [{ dx: 0, dy: 0 }],
  build: [{ dx: 0, dy: 0 }],
  groups: [],
  wall: {
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

/** The fixture content with the woodcutter's axe and the hunter's bow dealing {@link HOUSE_DAMAGE} in the
 *  building column, so either dents a wall. The plain fixture weapons list no building column at all. */
function wallBreakingContent(): ContentSet {
  const dentsWalls = (w: (typeof combatContent.weapons)[number]) => ({
    ...w,
    damage: { ...w.damage, [ARMOR_MATERIAL.HOUSE]: HOUSE_DAMAGE },
  });
  return parseContentSet({
    manifest: TEST_MANIFEST,
    ...economyContent,
    ...combatContent,
    ...societyContent,
    weapons: combatContent.weapons.map((w) =>
      w.id === 'test_axe'
        ? { ...dentsWalls(w), mainType: STRIKER_CLASS }
        : w.id === 'test_spear'
          ? dentsWalls(w)
          : w,
    ),
  });
}

function routesMap(): TerrainMap {
  return {
    ...grassNodeMap(WIDTH, HEIGHT),
    landscapes: { types: [WALL, CLOSED_GATE, OPEN_GATE], placements: [] },
  };
}

function fresh(content: ContentSet = wallBreakingContent()): Simulation {
  return new Simulation({ seed: 1, content, map: routesMap() });
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
  const breach = palisadeBarring(sim.world, ctxOf(sim), terrain, e, {
    start: terrain.nodeAt(at.hx, at.hy),
    goal: terrain.nodeAt(goal.hx, goal.hy),
  });
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
    // Short of the first post falling, which sends the squad on through the gap.
    sim.run(150);
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
    const breach = palisadeBarring(sim.world, ctxOf(sim), terrain, archer, {
      start: terrain.nodeAt(OUTSIDE.hx, OUTSIDE.hy),
      goal: terrain.nodeAt(CENTRE.hx, CENTRE.hy),
    });
    expect(breach?.wall).toBeDefined();
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

  it('take the bare building column from a blow, however seasoned the striker', () => {
    const firstBlow = (seasoned: boolean): number => {
      const sim = fresh();
      postRow(sim, WALL_ROW, P1);
      const wall = [...sim.world.query(Palisade)].find(
        (e) => nodeOfPosition(sim.world.get(e, Position).x, sim.world.get(e, Position).y).hx === GATE_X,
      );
      if (wall === undefined) throw new Error('expected a wall');
      const soldier = fighter(sim, { hx: GATE_X, hy: WALL_ROW - 2 }, P0);
      if (seasoned) {
        const bucket = fightExperienceTypeFor(STRIKER_CLASS);
        if (bucket === undefined) throw new Error('expected a sword fight bucket');
        sim.world.mut(soldier, SettlerProgress).experience = new Map([[bucket, SEASONED_HITS]]);
      }
      attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: soldier, target: wall });
      const full = sim.world.get(wall, Health).max;
      for (let tick = 0; tick < 600 && sim.world.get(wall, Health).hitpoints === full; tick++) sim.step();
      return full - sim.world.get(wall, Health).hitpoints;
    };
    const rookie = firstBlow(false);
    expect(rookie).toBeGreaterThan(0);
    expect(firstBlow(true)).toBe(rookie);
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

    // Felled at once rather than chopped down.
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

    // A wall takes far longer to fall, so every breaker ends up swinging from the near side, on or beside
    // the column of the node it was dealt: a walker stops once its wall comes into reach, so it may pull up
    // a node short of that dealt node. The fixture's civilians carry no body, so two may share a node here.
    sim.run(200);
    const terrain = mapped(sim);
    for (const [at, raider] of squad.entries()) {
      const stand = orders[at]?.breach?.stand;
      if (stand === undefined || stand === null) throw new Error('expected a dealt node');
      const here = nodeRow(sim, raider);
      expect(Math.abs(here.hx - terrain.xOf(stand))).toBeLessThanOrEqual(1);
      expect(here.hy).toBeLessThan(WALL_ROW);
      expect(hexDistance(here, { hx: here.hx, hy: WALL_ROW })).toBeLessThanOrEqual(WEAPON_REACH);
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

  function walledIn(wallOwner: number | null, content = wallBreakingContent()) {
    const sim = fresh(content);
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
    expect(order.breach?.enemy).toBe(shooter);

    // Felled at once rather than chopped down.
    sim.world.mut(order.target, Health).hitpoints = 0;
    sim.step();
    expect(sim.world.has(prisoner, AttackOrder)).toBe(false);
    const hurt = (): boolean => sim.world.get(shooter, Health).hitpoints < sim.world.get(shooter, Health).max;
    for (let tick = 0; tick < 600 && !hurt(); tick++) sim.step();
    expect(nodeRow(sim, prisoner).hy).toBeLessThan(WALL_ROW);
    expect(hurt()).toBe(true);
  });

  it('keeps its own breach and its enemy across a save', () => {
    const { sim, shooter, prisoner } = walledIn(P0);
    const order = breachOf(sim, prisoner);
    if (order === undefined) throw new Error('expected the prisoner to go for the wall');
    const restored = restoreSimulation(exportSaveGame(sim), {
      content: wallBreakingContent(),
      map: routesMap(),
    });
    expect(restored.world.get(prisoner, AttackOrder).breach?.enemy).toBe(shooter);
    for (let tick = 0; tick < 60; tick++) {
      sim.step();
      restored.step();
    }
    expect(restored.hashState()).toBe(sim.hashState());
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

  it('never goes for a wall its blow cannot dent', () => {
    const { sim, prisoner } = walledIn(P0, testContent());
    expect(breachOf(sim, prisoner)).toBeUndefined();
  });

  it('starts no siege to get at a wild animal', () => {
    const { sim, shooter, prisoner } = walledIn(P0);
    sim.world.destroy(shooter);
    const bear = fighterAt(sim, 0, 0, BEAR, null);
    sim.world.add(bear, Position, positionOfNode(SHOOTER.hx, SHOOTER.hy));
    let chased = false;
    for (let tick = 0; tick < 200; tick++) {
      sim.step();
      chased ||= sim.world.tryGet(prisoner, Engagement)?.stall?.target === bear;
      expect(sim.world.has(prisoner, AttackOrder)).toBe(false);
    }
    expect(chased).toBe(true);
  });

  it('fights back against an enemy that comes at it, then takes the wall up again', () => {
    const { sim, prisoner } = walledIn(P0);
    const order = breachOf(sim, prisoner);
    if (order === undefined) throw new Error('expected the prisoner to go for the wall');
    const at = nodeRow(sim, prisoner);
    const rival = fighter(sim, { hx: at.hx + 1, hy: at.hy + 1 }, P0);
    const hurt = (): boolean => sim.world.get(rival, Health).hitpoints < sim.world.get(rival, Health).max;
    for (let tick = 0; tick < 200 && !hurt(); tick++) sim.step();
    expect(hurt()).toBe(true);

    sim.world.mut(rival, Health).hitpoints = 0;
    const wall = sim.world.get(order.target, Health);
    const before = wall.hitpoints;
    for (let tick = 0; tick < 200 && sim.world.get(order.target, Health).hitpoints === before; tick++)
      sim.step();
    expect(sim.world.get(prisoner, AttackOrder).target).toBe(order.target);
    expect(sim.world.get(order.target, Health).hitpoints).toBeLessThan(before);
  });

  it('lets the wall be once the enemy it broke through for is gone', () => {
    const { sim, shooter, prisoner } = walledIn(P0);
    expect(breachOf(sim, prisoner)).toBeDefined();
    sim.world.mut(shooter, Health).hitpoints = 0;
    sim.run(2);
    expect(sim.world.has(prisoner, AttackOrder)).toBe(false);
  });

  it('keeps to its stance, running from the fight on FLEE', () => {
    const { sim, prisoner } = walledIn(P0);
    expect(breachOf(sim, prisoner)).toBeDefined();
    sim.world.mut(prisoner, Stance).mode = MILITARY_MODE.FLEE;
    sim.step();
    expect(sim.world.has(prisoner, AttackOrder)).toBe(false);
  });
});

describe('a breach the player ordered', () => {
  function orderedAtWalledInEnemy(content = wallBreakingContent()) {
    const sim = fresh(content);
    const gate = wallRow(sim, P1);
    sim.enqueueSetup({ kind: 'setPalisadeGate', palisade: gate, open: false });
    sim.step();
    const enemy = fighter(sim, SOUTH, P1);
    const soldier = fighter(sim, NORTH, P0);
    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: soldier, target: enemy });
    return { sim, enemy, soldier };
  }

  function breachOf(sim: Simulation, soldier: Entity) {
    for (let tick = 0; tick < 20 && sim.world.tryGet(soldier, AttackOrder)?.breach === undefined; tick++)
      sim.step();
    return sim.world.tryGet(soldier, AttackOrder);
  }

  it('dents the wall with real blows', () => {
    const { sim, soldier } = orderedAtWalledInEnemy();
    const order = breachOf(sim, soldier);
    if (order?.breach === undefined) throw new Error('expected the soldier to go for the wall');
    const full = sim.world.get(order.target, Health).max;
    for (let tick = 0; tick < 400 && sim.world.get(order.target, Health).hitpoints === full; tick++)
      sim.step();
    expect(sim.world.get(order.target, Health).hitpoints).toBeLessThan(full);
  });

  it('lets go of the wall once the ordered target is gone', () => {
    const { sim, enemy, soldier } = orderedAtWalledInEnemy();
    expect(breachOf(sim, soldier)?.breach?.resume).toBe(enemy);
    sim.world.mut(enemy, Health).hitpoints = 0;
    sim.run(2);
    expect(sim.world.has(soldier, AttackOrder)).toBe(false);
  });

  it('gives the order up when its blow cannot dent the wall', () => {
    const { sim, soldier } = orderedAtWalledInEnemy(testContent());
    sim.run(20);
    expect(sim.world.has(soldier, AttackOrder)).toBe(false);
  });

  it('keeps the ordered target when another wall bars the walk to the first', () => {
    const { sim, enemy, soldier } = orderedAtWalledInEnemy();
    const first = breachOf(sim, soldier)?.target;
    if (first === undefined) throw new Error('expected the soldier to go for the wall');
    const inner = WALL_ROW - 3;
    expect(nodeRow(sim, soldier).hy).toBeLessThan(inner);
    postRow(sim, inner, P1);
    for (let tick = 0; tick < 60 && sim.world.get(soldier, AttackOrder).target === first; tick++) sim.step();
    const order = sim.world.get(soldier, AttackOrder);
    expect(nodeRow(sim, order.target).hy).toBe(inner);
    expect(order.breach?.resume).toBe(enemy);
  });
});

describe('a wall falling', () => {
  function besieged() {
    const sim = fresh();
    const gate = wallRow(sim, P1);
    sim.enqueueSetup({ kind: 'setPalisadeGate', palisade: gate, open: false });
    sim.step();
    const raider = fighter(sim, NORTH, P0);
    attackMoveUnit(sim.world, ctxOf(sim), {
      kind: 'attackMoveUnit',
      entity: raider,
      x: SOUTH.hx,
      y: SOUTH.hy,
    });
    for (let tick = 0; tick < 20 && !sim.world.has(raider, AttackOrder); tick++) sim.step();
    const wall = sim.world.tryGet(raider, AttackOrder)?.target;
    if (wall === undefined) throw new Error('expected the raider to go for the wall');
    return { sim, raider, wall };
  }

  function wallAt(sim: Simulation, at: { hx: number; hy: number }): Entity {
    const wall = [...sim.world.query(Palisade)].find((e) => {
      const node = nodeRow(sim, e);
      return node.hx === at.hx && node.hy === at.hy;
    });
    if (wall === undefined) throw new Error(`expected a wall at ${at.hx},${at.hy}`);
    return wall;
  }

  it("off the breach's line leaves the breach chopping", () => {
    const { sim, raider, wall } = besieged();
    const lone = { hx: 2, hy: SOUTH.hy };
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL.typeId,
      x: lone.hx,
      y: lone.hy,
      tribe: VIKING,
      owner: P1,
    });
    sim.step();
    sim.world.mut(wallAt(sim, lone), Health).hitpoints = 0;
    sim.step();
    expect(sim.world.get(raider, AttackOrder).target).toBe(wall);
  });

  it('that never stood finished leaves the breach chopping, however close', () => {
    const { sim, raider, wall } = besieged();
    const beside = { hx: nodeRow(sim, wall).hx, hy: WALL_ROW + 1 };
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL.typeId,
      x: beside.hx,
      y: beside.hy,
      tribe: VIKING,
      owner: P1,
      underConstruction: true,
    });
    sim.step();
    sim.enqueueSetup({ kind: 'demolishPalisade', palisade: wallAt(sim, beside) });
    sim.step();
    expect(sim.world.get(raider, AttackOrder).target).toBe(wall);
  });

  it('itself releases the breach', () => {
    const { sim, raider, wall } = besieged();
    sim.world.mut(wall, Health).hitpoints = 0;
    sim.step();
    expect(sim.world.has(raider, AttackOrder)).toBe(false);
  });
});
