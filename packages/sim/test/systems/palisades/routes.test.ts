import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it, vi } from 'vitest';
import {
  AttackOrder,
  Building,
  Engagement,
  Health,
  Owner,
  Palisade,
  PathFollow,
  PlayerOrder,
  Position,
  SettlerProgress,
  Stance,
  setDiplomacyStance,
} from '../../../src/components/index.js';
import {
  type Entity,
  exportSaveGame,
  type Fixed,
  fx,
  nodeOfPosition,
  positionOfNode,
  restoreSimulation,
  type ScriptLandscapeType,
  Simulation,
  type TerrainMap,
} from '../../../src/index.js';
import { hexagonRing, hexDistance } from '../../../src/nav/halfcell.js';
import { findPath } from '../../../src/nav/pathfinding/index.js';
import { dynamicBlockOverlay } from '../../../src/systems/footprint/index.js';
import { walkBlockMask } from '../../../src/systems/footprint/walk-block-mask.js';
import { attackMoveBlocks } from '../../../src/systems/movement/attack-move-blocks.js';
import { structureRouteSealed, structureSameRegion } from '../../../src/systems/movement/structure-route.js';
import { attackMoveUnit, attackUnit, moveUnit } from '../../../src/systems/orders/index.js';
import { palisadeBarring } from '../../../src/systems/palisades/breach.js';
import { createPalisade } from '../../../src/systems/palisades/index.js';
import { fightExperienceTypeFor } from '../../../src/systems/progression/experience.js';
import { ARMOR_MATERIAL, MILITARY_MODE, WEAPON_MAIN_TYPE } from '../../../src/systems/readviews/index.js';
import { combatContent } from '../../fixtures/content/combat.js';
import { economyContent } from '../../fixtures/content/economy.js';
import { TEST_MANIFEST } from '../../fixtures/content/index.js';
import { societyContent } from '../../fixtures/content/societies.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import { fighterAt } from '../conflict/engagement/support.js';

const VIKING = 1;
const WOODCUTTER = 1;
/** The fixture's bow-armed job: a shooter's near reach keeps it off the wall. */
const HUNTER = 15;
/** The arrow munition class and a bow's arrow speed. */
const ARROW = 1;
const ARROW_SPEED = 8;
/** A bow reach that covers the wall and the row just behind it from {@link NORTH}, but not {@link SOUTH}. */
const SHOOTER_REACH = 12;
const DEEP_HEIGHT = 40;
/** `soldier_unarmed`: an enemy fighter that never strikes back. */
const UNARMED_SOLDIER = 31;
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

/** A tower-kind building with no posts to man, the defence wall's shape in the extracted houses, and a
 *  manned tower beside it. */
const DEFENCE_WALL = 90;
const WATCHTOWER = 91;
const DEFENCE_WALL_SPAN = GATE_SPAN;
/** Anchor spacing that joins {@link DEFENCE_WALL_SPAN} bodies end to end. */
const DEFENCE_WALL_STEP = DEFENCE_WALL_SPAN.length;

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
/** A wall post's column well clear of the gate. */
const PRESSED_X = 6;
const SOUTH = { hx: GATE_X, hy: 18 };
const DEEP_SOUTH = { hx: GATE_X, hy: DEEP_HEIGHT - 2 };
/** Enough attackers that the front fills and later ones queue in waiting ranks behind it. */
const PACKED_ARMY = 60;
/** Attackers enough to share one gate's route refusals. */
const BREACH_SQUAD = 4;

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
    buildings: [
      ...economyContent.buildings,
      {
        typeId: DEFENCE_WALL,
        id: 'defence_wall',
        kind: 'tower',
        hitpoints: 1000,
        footprint: { blocked: DEFENCE_WALL_SPAN },
      },
      {
        typeId: WATCHTOWER,
        id: 'watchtower',
        kind: 'tower',
        hitpoints: 1000,
        workers: [{ jobType: UNARMED_SOLDIER, count: 1 }],
      },
    ],
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

/** A finished wall row across the whole map on half-row `hy`, owned by `owner`, with an open gate at
 *  {@link GATE_X}. */
function wallRow(sim: Simulation, owner: number, hy = WALL_ROW): Entity {
  for (let hx = 0; hx < WIDTH; hx++) {
    if (Math.abs(hx - GATE_X) <= 2) continue;
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL.typeId,
      x: hx,
      y: hy,
      tribe: VIKING,
      owner,
    });
  }
  sim.enqueueSetup({
    kind: 'placePalisade',
    gfxIndex: OPEN_GATE.typeId,
    x: GATE_X,
    y: hy,
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
  it('lets a squad of attack-move attackers breach an automatic gate that closes during their march', () => {
    const sim = new Simulation({
      seed: 1,
      content: wallBreakingContent(),
      map: {
        ...grassNodeMap(WIDTH, 48),
        landscapes: { types: [WALL, CLOSED_GATE, OPEN_GATE], placements: [] },
      },
    });
    const gate = wallRow(sim, P1);
    // Three landed blows per segment keep this route regression short while exercising real damage.
    for (const wall of sim.world.query(Palisade, Health)) sim.world.mut(wall, Health).hitpoints = 3;
    const squad = Array.from({ length: BREACH_SQUAD }, (_, i) =>
      fighter(sim, { hx: 2 + (i % 10) * 2, hy: 25 + Math.floor(i / 10) * 2 }, P0),
    );
    sim.enqueueSetup({ kind: 'setPalisadeGateMode', palisade: gate, mode: 'automatic' });
    for (const entity of squad)
      sim.enqueueSetup({ kind: 'attackMoveUnit', entity, x: NORTH.hx, y: NORTH.hy });
    sim.step();
    expect(sim.world.get(gate, Palisade).gate?.open).toBe(true);
    sim.step();
    expect(squad.every((e) => sim.world.tryGet(e, AttackOrder)?.breach !== undefined)).toBe(true);
    for (let tick = 0; tick < 800 && sim.world.get(gate, Palisade).gate?.open; tick++) sim.step();
    expect(sim.world.get(gate, Palisade).gate?.open).toBe(false);
    for (
      let tick = 0;
      tick < 800 && !squad.every((e) => sim.world.tryGet(e, AttackOrder)?.breach !== undefined);
      tick++
    )
      sim.step();
    expect(squad.every((e) => sim.world.tryGet(e, AttackOrder)?.breach !== undefined)).toBe(true);
    const targets = new Set(squad.map((e) => sim.world.get(e, AttackOrder).target));
    expect([...targets].every((e) => sim.world.has(e, Palisade))).toBe(true);
    for (let tick = 0; tick < 1600 && !squad.every((e) => nodeRow(sim, e).hy < WALL_ROW); tick++) sim.step();
    expect([...targets].some((e) => !sim.world.isAlive(e))).toBe(true);
    expect(squad.every((e) => nodeRow(sim, e).hy < WALL_ROW)).toBe(true);
  });

  it.each(['automatic', 'open'] as const)(
    'packs a large attack-move army on its side of an %s gate while the wall survives',
    (mode) => {
      const base = wallBreakingContent();
      const content = parseContentSet({
        ...base,
        weapons: base.weapons.map((weapon) =>
          weapon.id === 'test_axe' ? { ...weapon, jobType: UNARMED_SOLDIER } : weapon,
        ),
      });
      const sim = new Simulation({
        seed: 1,
        content,
        map: {
          ...grassNodeMap(WIDTH, 48),
          landscapes: {
            types: [WALL, CLOSED_GATE, OPEN_GATE].map((type) => {
              if (type.wall === undefined) throw new Error('expected a wall type');
              return { ...type, wall: { ...type.wall, maxHitpoints: 1_000_000 } };
            }),
            placements: [],
          },
        },
      });
      const gate = wallRow(sim, P1);
      const squad = Array.from({ length: PACKED_ARMY }, (_, i) => {
        const e = fighterAt(sim, 0, 0, VIKING, UNARMED_SOLDIER, { owner: P0 });
        sim.world.add(e, Position, positionOfNode(2 + (i % 10) * 2, 25 + Math.floor(i / 10) * 2));
        return e;
      });
      sim.enqueueSetup({ kind: 'setPalisadeGateMode', palisade: gate, mode });
      for (const entity of squad)
        sim.enqueueSetup({ kind: 'attackMoveUnit', entity, x: NORTH.hx, y: NORTH.hy });
      // The ranks settle by about tick 300 and hold still after.
      for (let tick = 0; tick < 400; tick++) sim.step();
      expect(sim.world.get(gate, Palisade).gate?.open).toBe(mode === 'open');
      const positions = squad.map((e) => nodeRow(sim, e));
      expect(Math.max(...positions.map((p) => p.hy))).toBeLessThanOrEqual(WALL_ROW + 6);
      expect(positions.every((p) => p.hy > WALL_ROW)).toBe(true);
      const waiting = squad.filter((e) => sim.world.tryGet(e, Engagement)?.waiting === true);
      expect(waiting.length).toBeGreaterThan(20);
      const ranks = waiting.map((e) => nodeRow(sim, e));
      expect(new Set(ranks.map((p) => `${p.hx},${p.hy}`)).size).toBe(waiting.length);
      expect(new Set(squad.map((e) => JSON.stringify(sim.world.get(e, Position)))).size).toBe(squad.length);
      expect(sim.world.verifyCaches()).toEqual([]);
    },
  );

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
    // Each crosses the wall row at the gap, SE, zigzagging and SW, so all three reach it together.
    const trips = [
      { from: { hx: 8, hy: 2 }, to: { hx: 16, hy: 18 } },
      { from: { hx: 10, hy: 2 }, to: { hx: 14, hy: 18 } },
      { from: { hx: 17, hy: 2 }, to: { hx: 9, hy: 18 } },
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

  it("sends a walker ordered onto a closed gate between two open halves to the gate's near side", () => {
    // Each half holds about 750 nodes, past ROUTE_REGION_POCKET_CAP, so no pocket proof covers either.
    const height = 64;
    const row = 32;
    const sim = new Simulation({
      seed: 1,
      content: wallBreakingContent(),
      map: { ...routesMap(), ...grassNodeMap(WIDTH, height) },
    });
    const gate = wallRow(sim, P0, row);
    sim.enqueueSetup({ kind: 'setPalisadeGate', palisade: gate, open: false });
    sim.step();
    expect(sealed(sim, { hx: GATE_X, hy: 4 }, { hx: GATE_X, hy: height - 4 })).toBe(true);
    const north = fighter(sim, { hx: GATE_X, hy: 4 }, P0);
    const south = fighter(sim, { hx: GATE_X, hy: height - 4 }, P0);
    for (const walker of [north, south])
      moveUnit(sim.world, ctxOf(sim), { kind: 'moveUnit', entity: walker, x: GATE_X, y: row });

    let lost = 0;
    for (let tick = 0; tick < 400 && [north, south].some((w) => sim.world.has(w, PlayerOrder)); tick++) {
      sim.step();
      lost += sim.events.current().filter((ev) => ev.kind === 'settlerLost').length;
    }
    expect(lost).toBe(0);
    expect(sim.world.has(north, PlayerOrder) || sim.world.has(south, PlayerOrder)).toBe(false);
    // Each stops beside the gate on its own side.
    expect(row - nodeRow(sim, north).hy).toBeGreaterThan(0);
    expect(row - nodeRow(sim, north).hy).toBeLessThanOrEqual(2);
    expect(nodeRow(sim, south).hy - row).toBeGreaterThan(0);
    expect(nodeRow(sim, south).hy - row).toBeLessThanOrEqual(2);
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
    expect(blocked.has(terrain.nodeAt(GATE_X - 2, row + 1))).toBe(false);
  });
});

/** An enemy building of `buildingType` anchored on node `at`, placed finished - the test-setup exception. */
function buildingAt(
  sim: Simulation,
  at: { hx: number; hy: number },
  buildingType: number,
  owner: number,
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(at.hx, at.hy));
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: fx.fromInt(1), level: 0 });
  sim.world.add(e, Health, { hitpoints: 1000, max: 1000 });
  sim.world.add(e, Owner, { player: owner });
  return e;
}

/** Defence walls end to end along {@link WALL_ROW}, sealing the north off from the south. */
function defenceWallRow(sim: Simulation, owner: number): Entity[] {
  const walls: Entity[] = [];
  for (let hx = 2; hx - 2 < WIDTH; hx += DEFENCE_WALL_STEP)
    walls.push(buildingAt(sim, { hx, hy: WALL_ROW }, DEFENCE_WALL, owner));
  return walls;
}

describe('defence walls', () => {
  it("are never picked on a fighter's own, only broken to reach a tower behind them", () => {
    const sim = fresh();
    defenceWallRow(sim, P1);
    expect(sealed(sim)).toBe(true);
    const guard = fighter(sim, { hx: GATE_X, hy: WALL_ROW - 2 }, P0);
    sim.run(60);
    expect(sim.world.has(guard, Engagement)).toBe(false);

    const tower = buildingAt(sim, { hx: GATE_X, hy: WALL_ROW + 4 }, WATCHTOWER, P1);
    for (let tick = 0; tick < 200 && sim.world.tryGet(guard, AttackOrder)?.breach === undefined; tick++)
      sim.step();
    const order = sim.world.get(guard, AttackOrder);
    expect(order.breach?.enemy).toBe(tower);
    expect(sim.world.get(order.target, Building).buildingType).toBe(DEFENCE_WALL);
  });

  it('are broken through by an attack-move they bar, and one falling lets its whole line go', () => {
    const sim = fresh();
    defenceWallRow(sim, P1);
    const squad = [GATE_X, GATE_X - DEFENCE_WALL_STEP, GATE_X + DEFENCE_WALL_STEP].map((hx) =>
      fighter(sim, { hx, hy: 4 }, P0),
    );
    for (const raider of squad)
      attackMoveUnit(sim.world, ctxOf(sim), {
        kind: 'attackMoveUnit',
        entity: raider,
        x: SOUTH.hx,
        y: SOUTH.hy,
      });
    const breaching = (): boolean =>
      squad.every((r) => sim.world.tryGet(r, AttackOrder)?.breach !== undefined);
    for (let tick = 0; tick < 20 && !breaching(); tick++) sim.step();
    const targets = squad.map((r) => sim.world.get(r, AttackOrder).target);
    for (const wall of targets) expect(sim.world.get(wall, Building).buildingType).toBe(DEFENCE_WALL);
    const [lead] = squad;
    const [first] = targets;
    if (lead === undefined || first === undefined) throw new Error('expected a squad');
    const elsewhere = squad.filter((_, at) => targets[at] !== first);
    expect(elsewhere.length).toBeGreaterThan(0);

    // The first wall's gap lets every breaker on its line go, not only those striking it.
    sim.world.mut(first, Health).hitpoints = 0;
    sim.step();
    for (const raider of elsewhere) expect(sim.world.tryGet(raider, AttackOrder)?.breach).toBeUndefined();
    for (let tick = 0; tick < 600 && nodeRow(sim, lead).hy < SOUTH.hy; tick++) sim.step();
    expect(nodeRow(sim, lead)).toEqual(SOUTH);
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

  it.each(
    [4, 5].flatMap((hy) =>
      [-1, 1].flatMap((dx) =>
        [-2, 2].flatMap((dy) => [false, true].map((otherWall) => ({ hy, dx, dy, otherWall }))),
      ),
    ),
  )(
    'recognizes the wall on the between node from row $hy toward ($dx,$dy), opposite wall: $otherWall',
    ({ hy, dx, dy, otherWall }) => {
      const start = { hx: 3, hy };
      const goal = { hx: start.hx + dx, hy: hy + dy };
      const middle = { hx: Math.min(start.hx, goal.hx) + (hy & 1), hy: hy + dy / 2 };
      const other = { hx: start.hx + goal.hx - middle.hx, hy: middle.hy };
      const typeIds = new Array<number>(80).fill(1);
      for (const point of [start, middle, other, goal]) typeIds[point.hy * 8 + point.hx] = 0;
      const sim = new Simulation({
        seed: 1,
        content: wallBreakingContent(),
        map: {
          ...grassNodeMap(8, 10),
          typeIds,
          landscapes: { types: [WALL], placements: [] },
        },
      });
      // The opposite post has the lower ID, but removing it cannot open this way.
      if (otherWall)
        sim.enqueueSetup({
          kind: 'placePalisade',
          gfxIndex: WALL.typeId,
          x: other.hx,
          y: other.hy,
          tribe: VIKING,
          owner: P1,
        });
      sim.enqueueSetup({
        kind: 'placePalisade',
        gfxIndex: WALL.typeId,
        x: middle.hx,
        y: middle.hy,
        tribe: VIKING,
        owner: P1,
      });
      sim.step();
      const raider = fighter(sim, start, P0);
      const wall = [...sim.world.query(Palisade)].find((e) => nodeRow(sim, e).hx === middle.hx);
      expect(wall).toBeDefined();
      expect(sealed(sim, start, goal)).toBe(true);
      expect(barring(sim, raider, goal)).toBe(wall);
      if (wall === undefined) throw new Error('expected the between-node wall');
      sim.world.mut(wall, Health).hitpoints = 1;
      attackMoveUnit(sim.world, ctxOf(sim), {
        kind: 'attackMoveUnit',
        entity: raider,
        x: goal.hx,
        y: goal.hy,
      });
      sim.run(400);
      expect(sim.world.has(wall, Palisade)).toBe(false);
      expect(nodeRow(sim, raider)).toEqual(goal);
    },
  );

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

describe('attack-move planning around open enemy gates', () => {
  it.each(
    [false, true].flatMap((centreLast) =>
      [GATE_X - 3, GATE_X, GATE_X + 3].map((fallenColumn) => ({ centreLast, fallenColumn })),
    ),
  )(
    'resumes both sides of a converted open gate after column $fallenColumn falls (centre built last: $centreLast)',
    ({ centreLast, fallenColumn }) => {
      const sim = fresh();
      postRow(sim, WALL_ROW, P1, centreLast ? [GATE_X] : []);
      if (centreLast) {
        sim.enqueueSetup({
          kind: 'placePalisade',
          gfxIndex: WALL.typeId,
          x: GATE_X,
          y: WALL_ROW,
          tribe: VIKING,
          owner: P1,
        });
        sim.step();
      }
      const gate = [...sim.world.query(Palisade)].find((e) => nodeRow(sim, e).hx === GATE_X);
      if (gate === undefined) throw new Error('expected the central wall');
      sim.enqueueSetup({ kind: 'convertPalisadeGate', palisade: gate, gfxIndex: CLOSED_GATE.typeId });
      sim.step();
      sim.enqueueSetup({ kind: 'setPalisadeGateMode', palisade: gate, mode: 'open' });
      sim.step();
      expect(sim.world.get(gate, Palisade).gate?.open).toBe(true);
      const squad = [GATE_X - 6, GATE_X + 6].map((hx) => {
        const entity = fighter(sim, { hx, hy: NORTH.hy }, P0);
        sim.enqueueSetup({ kind: 'attackMoveUnit', entity, x: hx, y: SOUTH.hy });
        return entity;
      });
      for (let tick = 0; tick < 20 && squad.some((e) => !sim.world.has(e, AttackOrder)); tick++) sim.step();
      for (const e of squad) {
        const order = sim.world.get(e, AttackOrder);
        expect(order.breach).toBeDefined();
        expect(nodeRow(sim, order.target).hx).toBe(nodeRow(sim, e).hx);
      }
      const fallen = [...sim.world.query(Palisade)].find((e) => nodeRow(sim, e).hx === fallenColumn);
      if (fallen === undefined) throw new Error('expected a segment of the gate run');
      const restored = restoreSimulation(exportSaveGame(sim), { content: sim.content, map: routesMap() });
      for (const run of [sim, restored]) {
        run.world.mut(fallen, Health).hitpoints = 0;
        run.step();
        expect(squad.every((e) => !run.world.has(e, AttackOrder))).toBe(true);
        // Where each stands once its order is done: an idle settler then goes about its own errands.
        for (let tick = 0; tick < 600 && squad.some((e) => run.world.has(e, PlayerOrder)); tick++) run.step();
        expect(squad.every((e) => nodeRow(run, e).hy === SOUTH.hy)).toBe(true);
        expect(run.world.verifyCaches()).toEqual([]);
      }
      expect(restored.hashState()).toBe(sim.hashState());
    },
  );

  it.each([PRESSED_X, GATE_X])(
    'breaches from column %s while the enemy gate stays open, then uses the hole',
    (hx) => {
      const sim = fresh();
      const gate = wallRow(sim, P1);
      const raider = fighter(sim, { hx, hy: NORTH.hy }, P0);
      attackMoveUnit(sim.world, ctxOf(sim), { kind: 'attackMoveUnit', entity: raider, x: hx, y: SOUTH.hy });
      for (let tick = 0; tick < 20 && !sim.world.has(raider, AttackOrder); tick++) sim.step();
      const target = sim.world.tryGet(raider, AttackOrder)?.target;
      if (target === undefined) throw new Error('expected a breach before approaching the open gate');
      expect(nodeRow(sim, target)).toEqual({ hx, hy: WALL_ROW });
      expect(sim.world.get(gate, Palisade).gate?.open).toBe(true);
      expect(sealed(sim)).toBe(false);
      const restored = restoreSimulation(exportSaveGame(sim), { content: sim.content, map: routesMap() });
      sim.world.mut(target, Health).hitpoints = 0;
      restored.world.mut(target, Health).hitpoints = 0;
      for (let tick = 0; tick < 600 && nodeRow(sim, raider).hy < SOUTH.hy; tick++) {
        sim.step();
        restored.step();
      }
      expect(nodeRow(sim, raider)).toEqual({ hx, hy: SOUTH.hy });
      expect(restored.hashState()).toBe(sim.hashState());
      expect(sim.world.verifyCaches()).toEqual([]);
    },
  );

  it.each(['move', 'own', 'friend', 'neutral'] as const)('keeps the open passage for %s', (mode) => {
    const sim = fresh();
    const gate = wallRow(sim, mode === 'own' ? P0 : P1);
    if (mode === 'friend' || mode === 'neutral') setDiplomacyStance(sim.world, P0, P1, mode);
    const raider = fighter(sim, NORTH, P0);
    const command = { entity: raider, x: SOUTH.hx, y: SOUTH.hy };
    if (mode === 'move') moveUnit(sim.world, ctxOf(sim), { kind: 'moveUnit', ...command });
    else attackMoveUnit(sim.world, ctxOf(sim), { kind: 'attackMoveUnit', ...command });
    for (let tick = 0; tick < 600 && nodeRow(sim, raider).hy < SOUTH.hy; tick++) {
      sim.step();
      expect(sim.world.has(raider, AttackOrder)).toBe(false);
    }
    expect(nodeRow(sim, raider)).toEqual(SOUTH);
    expect(sim.world.get(gate, Health).hitpoints).toBe(100);
  });

  it('keeps virtual gate bodies and open corners consistent when a door changes', () => {
    const DOOR_HUT = 999;
    const base = wallBreakingContent();
    const content = parseContentSet({
      ...base,
      buildings: [
        ...base.buildings,
        {
          typeId: DOOR_HUT,
          id: 'door_hut',
          kind: 'storage',
          footprint: { blocked: [{ dx: 0, dy: 0 }], door: { dx: 0, dy: 0 } },
        },
      ],
    });
    const sim = fresh(content);
    const terrain = mapped(sim);
    createPalisade(
      sim.world,
      { ...OPEN_GATE, walk: [] },
      {
        x: 10,
        y: 10,
        tribe: VIKING,
        owner: P1,
        underConstruction: false,
        placementWalk: [{ dx: 0, dy: 0 }],
      },
    );
    createPalisade(sim.world, WALL, { x: 9, y: 11, tribe: VIKING, owner: P1, underConstruction: false });
    const plan = () => attackMoveBlocks(sim.world, ctxOf(sim), terrain, P0);
    const oddCorner = terrain.nodeAt(10, 11);
    const evenCorner = terrain.nodeAt(9, 10);
    expect(plan().blocked.has(oddCorner)).toBe(false);
    expect(plan().blocked.has(evenCorner)).toBe(false);
    const version = walkBlockMask(sim.world, ctxOf(sim), terrain).version;
    const hut = sim.world.create();
    sim.world.add(hut, Position, positionOfNode(10, 11));
    sim.world.add(hut, Building, { buildingType: DOOR_HUT, tribe: VIKING, built: fx.fromInt(1), level: 0 });
    expect(walkBlockMask(sim.world, ctxOf(sim), terrain).version).toBe(version);
    expect(plan().blocked.has(oddCorner)).toBe(false);
    expect(plan().blocked.has(evenCorner)).toBe(false);
    const restored = restoreSimulation(exportSaveGame(sim), { content, map: routesMap() });
    const cold = attackMoveBlocks(restored.world, ctxOf(restored), mapped(restored), P0);
    for (let node = 0; node < terrain.nodeCount; node++) {
      const cell = terrain.nodeAt(node % terrain.width, Math.floor(node / terrain.width));
      expect(cold.blocked.has(cell)).toBe(plan().blocked.has(cell));
    }
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('shares the predicted closed topology and refreshes it after diplomacy, owner and wall changes', () => {
    const sim = fresh();
    const gate = wallRow(sim, P1);
    const terrain = mapped(sim);
    const start = terrain.nodeAt(NORTH.hx, NORTH.hy);
    const goal = terrain.nodeAt(SOUTH.hx, SOUTH.hy);
    const plan = () => attackMoveBlocks(sim.world, ctxOf(sim), terrain, P0);
    const first = plan();
    expect(plan()).toBe(first);
    expect(structureRouteSealed(sim.world, ctxOf(sim), terrain, start, goal, first.blocked)).toBe(true);
    expect(structureSameRegion(sim.world, ctxOf(sim), terrain, start, goal, first.blocked)).toBe(false);
    // A route search prepares its gate once; a flood steps through `stepsIntoAt`.
    const searches = vi.spyOn(terrain, 'resetGate');
    const steps = vi.spyOn(terrain, 'stepsIntoAt');
    for (let i = 0; i < 100; i++) {
      expect(
        structureRouteSealed(
          sim.world,
          ctxOf(sim),
          terrain,
          terrain.nodeAt(i % WIDTH, 2),
          terrain.nodeAt(i % WIDTH, 18),
          plan().blocked,
        ),
      ).toBe(true);
    }
    expect(searches).not.toHaveBeenCalled();
    expect(steps).not.toHaveBeenCalled();
    searches.mockRestore();
    steps.mockRestore();
    setDiplomacyStance(sim.world, P0, P1, 'friend');
    expect(findPath(terrain, start, goal, plan().blocked)).not.toBeNull();
    setDiplomacyStance(sim.world, P0, P1, 'enemy');
    sim.world.mut(gate, Owner).player = P0;
    expect(findPath(terrain, start, goal, plan().blocked)).not.toBeNull();
    sim.world.mut(gate, Owner).player = P1;
    expect(findPath(terrain, start, goal, plan().blocked)).toBeNull();
    const wall = [...sim.world.query(Palisade)].find((e) => nodeRow(sim, e).hx === PRESSED_X);
    if (wall === undefined) throw new Error('missing side wall');
    sim.world.mut(wall, Health).hitpoints = 0;
    sim.step();
    expect(structureRouteSealed(sim.world, ctxOf(sim), terrain, start, goal, plan().blocked)).toBe(false);
    expect(sim.world.verifyCaches()).toEqual([]);
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

  it('attacks the wall from a raider pressed against it, never stepping through', () => {
    const sim = fresh();
    const gate = wallRow(sim, P1);
    sim.enqueueSetup({ kind: 'setPalisadeGate', palisade: gate, open: false });
    sim.step();
    // Three quarters of the way to a wall post: the post is the nearest node to where it stands.
    const near = positionOfNode(PRESSED_X, WALL_ROW - 1);
    const post = positionOfNode(PRESSED_X, WALL_ROW);
    const along = (a: Fixed, b: Fixed): Fixed =>
      fx.add(a, fx.mulDiv(fx.sub(b, a), fx.fromInt(3), fx.fromInt(4)));
    const raider = fighter(sim, NORTH, P0);
    sim.world.add(raider, Position, { x: along(near.x, post.x), y: along(near.y, post.y) });
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
    // Still on its own side: three quarters along it reads the post, but never crosses the wall's row.
    expect(sim.world.get(raider, Position).y).toBeLessThan(post.y);
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

describe('a shooter breaking a wall', () => {
  /** {@link wallBreakingContent} with the hunter's bow firing arrows, so it shoots as a ranged weapon. */
  function shooterContent(): ContentSet {
    const base = wallBreakingContent();
    return {
      ...base,
      weapons: base.weapons.map((w) =>
        w.jobType === HUNTER ? { ...w, munitionType: ARROW, speed: ARROW_SPEED, maxRange: SHOOTER_REACH } : w,
      ),
    };
  }

  /** {@link routesMap} reaching far enough south that a bow at the wall cannot reach an enemy at its end. */
  function deepSouthMap(): TerrainMap {
    return { ...routesMap(), ...grassNodeMap(WIDTH, DEEP_HEIGHT) };
  }

  it('shoots an enemy fighter behind the wall rather than the wall, then takes the wall up again', () => {
    const sim = fresh(shooterContent());
    const gate = wallRow(sim, P1);
    sim.enqueueSetup({ kind: 'setPalisadeGate', palisade: gate, open: false });
    sim.step();
    const archer = fighterAt(sim, 0, 0, VIKING, HUNTER, { owner: P0 });
    sim.world.add(archer, Position, positionOfNode(NORTH.hx, NORTH.hy));
    attackMoveUnit(sim.world, ctxOf(sim), {
      kind: 'attackMoveUnit',
      entity: archer,
      x: SOUTH.hx,
      y: SOUTH.hy,
    });
    for (let tick = 0; tick < 20 && sim.world.tryGet(archer, AttackOrder)?.breach === undefined; tick++)
      sim.step();
    const wall = sim.world.tryGet(archer, AttackOrder)?.target;
    if (wall === undefined) throw new Error('expected the archer to go for the wall');
    expect(sim.world.has(wall, Palisade)).toBe(true);

    const defender = fighterAt(sim, 0, 0, VIKING, UNARMED_SOLDIER, { owner: P1 });
    sim.world.add(defender, Position, positionOfNode(NORTH.hx, WALL_ROW + 2));
    const hurt = (): boolean =>
      sim.world.get(defender, Health).hitpoints < sim.world.get(defender, Health).max;
    for (let tick = 0; tick < 400 && !hurt(); tick++) sim.step();
    expect(hurt()).toBe(true);
    expect(sim.world.get(archer, AttackOrder).target).toBe(wall);

    sim.world.destroy(defender);
    for (let tick = 0; tick < 40 && sim.world.tryGet(archer, Engagement)?.target !== wall; tick++) sim.step();
    expect(sim.world.get(archer, Engagement).target).toBe(wall);
  });

  it('ordered at a civilian behind the wall, shoots the wall rather than another civilian in reach', () => {
    const sim = new Simulation({ seed: 1, content: shooterContent(), map: deepSouthMap() });
    const gate = wallRow(sim, P1);
    sim.enqueueSetup({ kind: 'setPalisadeGate', palisade: gate, open: false });
    sim.step();
    const archer = fighterAt(sim, 0, 0, VIKING, HUNTER, { owner: P0 });
    sim.world.add(archer, Position, positionOfNode(NORTH.hx, NORTH.hy));
    const target = fighter(sim, DEEP_SOUTH, P1);
    const bystander = fighter(sim, { hx: NORTH.hx, hy: WALL_ROW + 2 }, P1);
    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: archer, target });
    for (let tick = 0; tick < 200 && sim.world.tryGet(archer, AttackOrder)?.breach === undefined; tick++)
      sim.step();
    const wall = sim.world.tryGet(archer, AttackOrder)?.target;
    if (wall === undefined) throw new Error('expected the archer to go for the wall');
    expect(sim.world.has(wall, Palisade)).toBe(true);
    const full = sim.world.get(wall, Health).max;
    for (let tick = 0; tick < 400 && sim.world.get(wall, Health).hitpoints === full; tick++) sim.step();
    expect(sim.world.get(wall, Health).hitpoints).toBeLessThan(full);
    expect(sim.world.get(bystander, Health).hitpoints).toBe(sim.world.get(bystander, Health).max);
  });

  it('ordered at a civilian behind the wall, still shoots an enemy fighter in reach before the wall', () => {
    const sim = new Simulation({ seed: 1, content: shooterContent(), map: deepSouthMap() });
    const gate = wallRow(sim, P1);
    sim.enqueueSetup({ kind: 'setPalisadeGate', palisade: gate, open: false });
    sim.step();
    const archer = fighterAt(sim, 0, 0, VIKING, HUNTER, { owner: P0 });
    sim.world.add(archer, Position, positionOfNode(NORTH.hx, NORTH.hy));
    const target = fighter(sim, DEEP_SOUTH, P1);
    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: archer, target });
    for (let tick = 0; tick < 200 && sim.world.tryGet(archer, AttackOrder)?.breach === undefined; tick++)
      sim.step();
    const wall = sim.world.tryGet(archer, AttackOrder)?.target;
    if (wall === undefined) throw new Error('expected the archer to go for the wall');
    expect(sim.world.has(wall, Palisade)).toBe(true);

    // Placed once the breach stands, or the archer shoots it on its way and never breaches.
    const defender = fighterAt(sim, 0, 0, VIKING, UNARMED_SOLDIER, { owner: P1 });
    sim.world.add(defender, Position, positionOfNode(NORTH.hx, WALL_ROW + 2));
    const hurt = (): boolean =>
      sim.world.get(defender, Health).hitpoints < sim.world.get(defender, Health).max;
    for (let tick = 0; tick < 400 && !hurt(); tick++) sim.step();
    expect(hurt()).toBe(true);
    expect(sim.world.get(archer, AttackOrder).target).toBe(wall);
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

  it('fights back against an enemy in reach by map points but not by grid steps', () => {
    const { sim, prisoner } = walledIn(P0);
    const order = breachOf(sim, prisoner);
    if (order === undefined) throw new Error('expected the prisoner to go for the wall');
    const at = nodeRow(sim, prisoner);
    // The fixture weapon reaches 2 map points; on the half-cell lattice part of that ring lies more than 2
    // grid steps away, and the breaker's rival check counts map points like every other search.
    const beside = [...hexagonRing(at, 2)]
      .map(({ point }) => point)
      .find((n) => Math.abs(n.hx - at.hx) + Math.abs(n.hy - at.hy) > 2);
    if (beside === undefined) throw new Error('expected a ring node beyond two grid steps');
    const rival = fighter(sim, beside, P0);
    // Holding its ground under IGNORE, the rival never walks into grid reach on its own.
    sim.world.mut(rival, Stance).mode = MILITARY_MODE.IGNORE;
    const hurt = (): boolean => sim.world.get(rival, Health).hitpoints < sim.world.get(rival, Health).max;
    for (let tick = 0; tick < 200 && !hurt(); tick++) sim.step();
    expect(hurt()).toBe(true);
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

  it('stays on the wall while another enemy fighter stands just behind it', () => {
    const { sim, enemy, soldier } = orderedAtWalledInEnemy();
    const order = breachOf(sim, soldier);
    if (order?.breach === undefined) throw new Error('expected the soldier to go for the wall');
    for (let tick = 0; tick < 40 && sim.world.tryGet(soldier, Engagement)?.target !== order.target; tick++)
      sim.step();
    const at = nodeRow(sim, soldier);
    const behind = fighterAt(sim, 0, 0, VIKING, UNARMED_SOLDIER, { owner: P1 });
    sim.world.add(behind, Position, positionOfNode(at.hx, WALL_ROW + 1));
    const wall = order.target;
    const before = sim.world.get(wall, Health).hitpoints;
    for (let tick = 0; tick < 120; tick++) {
      sim.step();
      expect(sim.world.get(soldier, Engagement).target).toBe(wall);
    }
    expect(sim.world.get(wall, Health).hitpoints).toBeLessThan(before);
    expect(sim.world.get(soldier, AttackOrder).breach?.resume).toBe(enemy);
    expect(sim.world.get(behind, Health).hitpoints).toBe(sim.world.get(behind, Health).max);
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
