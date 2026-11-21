import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AttackOrder,
  Building,
  CurrentAtomic,
  Engagement,
  Health,
  MoveGoal,
  Owner,
  PathFollow,
  PathRoute,
  Position,
  Stance,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
  fx,
  hexDistanceBetween,
  nodeOfPosition,
  ONE,
  playerCommand,
  positionOfNode,
  Simulation,
  type TerrainMap,
} from '../../../src/index.js';
import type { NodeId, TerrainGraph } from '../../../src/nav/terrain/index.js';
import { REPATH_CADENCE } from '../../../src/systems/conflict/chase.js';
import { buildingBodyNodes } from '../../../src/systems/conflict/target-node.js';
import { MILITARY_MODE, type MilitaryMode } from '../../../src/systems/readviews/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { addSettlerOfTribe } from '../../fixtures/settler.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

// A group attack order on a building whose way is crowded: the army walks on toward the target as a body,
// each man as close as he gets, and the overflow jams in the narrow way rather than taking another one.

const VIKING = 1;
/** A tribe with no content record: a valid enemy whose soldier resolves no weapon, so it never steps out
 *  of its line to fight, while its standing body still blocks an enemy's route. */
const UNARMED_TRIBE = 99;
/** `soldier_unarmed`: a fighter trade, so its body collides and a standing one blocks an enemy's route. */
const SOLDIER = 31;
/** Appended: the soldier's melee weapon, a strict one-node band. */
const MACE = 12;
const MACE_REACH = 1;
const MACE_DAMAGE = { '0': 50 };
/** Appended: a building with a 2x2 half-cell body. */
const FORT = 91;
const FORT_SIDE = 2;
/** Appended: buildings with the bodies of real ones, in half-cell nodes. */
const HALL = 92;
const HALL_BODY = { width: 6, height: 7 };
const KEEP = 93;
const KEEP_BODY = { width: 9, height: 9 };
const ATTACKER = 0;
const DEFENDER = 1;

const GRASS = 0;
const WATER = 1;

/** Outlasts every blow a test lands. */
const STURDY_HP = 1_000_000;

/** Every node of a `width` by `height` body from its anchor. */
function bodyBlock(width: number, height: number): { dx: number; dy: number }[] {
  const body = [];
  for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) body.push({ dx, dy });
  return body;
}

/** The shared fixture plus the walled forts and the soldier's mace. */
function crowdContent(): ContentSet {
  const base = testContent();
  const building = (typeId: number, id: string, body: { dx: number; dy: number }[]) => ({
    typeId,
    id,
    kind: 'home' as const,
    hitpoints: STURDY_HP,
    footprint: { blocked: body },
  });
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      building(FORT, 'fort', bodyBlock(FORT_SIDE, FORT_SIDE)),
      building(HALL, 'hall', bodyBlock(HALL_BODY.width, HALL_BODY.height)),
      building(KEEP, 'keep', bodyBlock(KEEP_BODY.width, KEEP_BODY.height)),
    ],
    weapons: [
      ...base.weapons,
      {
        typeId: MACE,
        id: 'test_mace',
        tribeType: VIKING,
        jobType: SOLDIER,
        minRange: MACE_REACH,
        maxRange: MACE_REACH,
        damage: MACE_DAMAGE,
      },
    ],
  });
}

interface Node {
  readonly hx: number;
  readonly hy: number;
}

/** A half-cell node map of grass with water wherever `water` answers true. */
function nodeMap(width: number, height: number, water: (hx: number, hy: number) => boolean): TerrainMap {
  const typeIds: number[] = [];
  for (let hy = 0; hy < height; hy++) {
    for (let hx = 0; hx < width; hx++) typeIds.push(water(hx, hy) ? WATER : GRASS);
  }
  return { ...grassNodeMap(width, height), typeIds };
}

function crowdSim(map: TerrainMap): { sim: Simulation; terrain: TerrainGraph } {
  const sim = new Simulation({ seed: 1, content: crowdContent(), map });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('fixture: the scene needs a map');
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: false });
  return { sim, terrain };
}

/** An owned soldier of `tribe` standing exactly on `node`. */
function soldierOn(
  sim: Simulation,
  node: Node,
  owner: number,
  mode: MilitaryMode,
  tribe = VIKING,
  hitpoints = STURDY_HP,
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(node.hx, node.hy));
  addSettlerOfTribe(sim, e, {
    tribe,
    jobType: SOLDIER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Health, { hitpoints, max: hitpoints });
  sim.world.add(e, Owner, { player: owner });
  sim.world.add(e, Stance, { mode, anchorCell: null });
  return e;
}

/** A finished enemy fort with its body's top-left node on `anchor` (an even row), placed as setup. */
function fortAt(sim: Simulation, anchor: Node, buildingType = FORT): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(anchor.hx, anchor.hy));
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Health, { hitpoints: STURDY_HP, max: STURDY_HP });
  sim.world.add(e, Owner, { player: DEFENDER });
  return e;
}

/** A block of attackers, `perRow` to a row from `first`, one node apart. */
function attackersFrom(sim: Simulation, first: Node, count: number, perRow: number): Entity[] {
  return Array.from({ length: count }, (_, i) =>
    soldierOn(
      sim,
      { hx: first.hx + (i % perRow), hy: first.hy + Math.floor(i / perRow) },
      ATTACKER,
      MILITARY_MODE.ATTACK,
    ),
  );
}

/** The player's right-click on `target` with the whole army selected. */
function orderAttack(sim: Simulation, army: readonly Entity[], target: Entity): void {
  sim.enqueue(
    playerCommand(ATTACKER, {
      kind: 'attackUnitGroup',
      members: army.map((entity) => ({ entity })),
      target,
    }),
  );
}

function nodeOf(sim: Simulation, e: Entity): Node {
  const p = sim.world.get(e, Position);
  return nodeOfPosition(p.x, p.y);
}

/** The nodes `e` is headed for: its goal and the stops of its route still ahead. */
function plannedNodes(sim: Simulation, terrain: TerrainGraph, e: Entity): Node[] {
  const planned: NodeId[] = [];
  const goal = sim.world.tryGet(e, MoveGoal)?.cell;
  if (goal !== undefined) planned.push(goal);
  const route = sim.world.tryGet(e, PathRoute)?.waypoints ?? [];
  const from = sim.world.tryGet(e, PathFollow)?.index ?? 0;
  for (const stop of route.slice(from)) planned.push(stop.node);
  return planned.map((n) => ({ hx: terrain.xOf(n), hy: terrain.yOf(n) }));
}

/** Whether `e` still holds its attack order on `target`, directly or through a breach leading back to it. */
function holdsOrder(sim: Simulation, e: Entity, target: Entity): boolean {
  const order = sim.world.tryGet(e, AttackOrder);
  return order?.target === target || order?.breach?.resume === target;
}

/** The map-point distance from `node` to the nearest node of `body`. */
function reachTo(node: Node, body: readonly Node[]): number {
  return Math.min(...body.map((b) => hexDistanceBetween(node.hx, node.hy, b.hx, b.hy)));
}

function bodyOf(sim: Simulation, terrain: TerrainGraph, fort: Entity): Node[] {
  return buildingBodyNodes(sim.world, ctxOf(sim), terrain, fort).map((n) => ({
    hx: terrain.xOf(n),
    hy: terrain.yOf(n),
  }));
}

/** The enemy `e` swings at this tick, or undefined. */
function striking(sim: Simulation, e: Entity): Entity | undefined {
  const effect = sim.world.tryGet(e, CurrentAtomic)?.effect;
  return effect?.kind === 'attack' ? effect.target : undefined;
}

/** The map points between two soldiers' nodes. */
function apart(sim: Simulation, a: Entity, b: Entity): number {
  const p = nodeOf(sim, a);
  const q = nodeOf(sim, b);
  return hexDistanceBetween(p.hx, p.hy, q.hx, q.hy);
}

/** The nodes two standing soldiers share. */
function sharedStands(sim: Simulation, soldiers: readonly Entity[]): string[] {
  const seen = new Map<string, number>();
  for (const e of soldiers) {
    if (!sim.world.isAlive(e) || sim.world.has(e, PathFollow)) continue;
    const n = nodeOf(sim, e);
    const key = `${n.hx},${n.hy}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen].filter(([, count]) => count > 1).map(([key]) => key);
}

/** Step `ticks`, and after every tick log the nodes two of `soldiers` stand on, by tick. */
function runSampled(
  sim: Simulation,
  soldiers: readonly Entity[],
  ticks: number,
  afterTick: () => void = () => {},
): Map<number, string[]> {
  const shared = new Map<number, string[]>();
  for (let tick = 0; tick < ticks; tick++) {
    sim.step();
    afterTick();
    const nodes = sharedStands(sim, soldiers);
    if (nodes.length > 0) shared.set(sim.tick, nodes);
  }
  return shared;
}

/** What a run shows, by offending attacker: its longest plan that took the long way, as that plan's first
 *  node there and its stop count, its farthest drift past its start, and the tick it lost its order; and the
 *  nodes two soldiers stood on ({@link runSampled}). */
interface RunLog {
  readonly detours: Map<Entity, { readonly node: Node; readonly stops: number }>;
  readonly drifted: Map<Entity, number>;
  readonly lostOrder: Map<Entity, number>;
  readonly shared: Map<number, string[]>;
}

/**
 * Step `ticks`, and after every tick log each living attacker whose plan reaches a node `strayed` calls
 * the long way, who stands more than `slack` farther from `anchor` than it started, or who no longer holds
 * its order on `fort` while the fort stands; `soldiers` are every body whose node is watched.
 */
function runLogged(
  sim: Simulation,
  terrain: TerrainGraph,
  army: readonly Entity[],
  fort: Entity,
  ticks: number,
  watch: {
    strayed: (node: Node) => boolean;
    anchor: Node;
    slack: number;
    soldiers: readonly Entity[];
    /** Read after each tick, beside the log. */
    each?: () => void;
  },
): RunLog {
  const detours: RunLog['detours'] = new Map();
  const drifted: RunLog['drifted'] = new Map();
  const lostOrder: RunLog['lostOrder'] = new Map();
  const fromAnchor = (n: Node): number => hexDistanceBetween(n.hx, n.hy, watch.anchor.hx, watch.anchor.hy);
  const start = new Map(army.map((e) => [e, fromAnchor(nodeOf(sim, e))]));
  const log = { detours, drifted, lostOrder };
  const shared = runSampled(sim, watch.soldiers, ticks, () => {
    watch.each?.();
    for (const e of army) {
      if (!sim.world.isAlive(e)) continue;
      const plan = plannedNodes(sim, terrain, e);
      const far = plan.find(watch.strayed);
      if (far !== undefined && plan.length > (log.detours.get(e)?.stops ?? 0))
        log.detours.set(e, { node: far, stops: plan.length });
      const drift = fromAnchor(nodeOf(sim, e)) - (start.get(e) ?? 0);
      if (drift > watch.slack) log.drifted.set(e, Math.max(drift, log.drifted.get(e) ?? 0));
      if (sim.world.isAlive(fort) && !holdsOrder(sim, e, fort) && !log.lostOrder.has(e))
        log.lostOrder.set(e, sim.tick);
    }
  });
  return { ...log, shared };
}

describe('a group attack order through an enemy line holding a gap', () => {
  // Half-cell nodes. A one-node wall of water across the map, with a two-node gap near the attackers and
  // an opening at its far end, a walk several times longer:
  //
  //             FF                                     the fort at 10..11, rows 4..5
  //   ~~~~~~~~~~EE~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~     row 12, the gap at 10..11 held by E, opening 44..47
  //          AAAAAAAA                                  row 15, hx 7..14
  const WIDTH = 48;
  const HEIGHT = 24;
  const WALL_ROW = 12;
  const GAP = { from: 10, to: 11 };
  const FAR_OPENING = 44;
  const FORT_ANCHOR = { hx: 10, hy: 4 };
  const ARMY = 8;
  const ARMY_FIRST = { hx: 7, hy: 15 };
  const ARMY_PER_ROW = 8;
  /** Every node at or past this column lies on the far half of the wall, toward the far opening. */
  const FAR_HALF = WIDTH / 2;
  /** How far past its start (map points from the gap) a man may stand while the crowd settles. */
  const DRIFT_SLACK = 2;
  /** How near the gap (map points) the jammed crowd stands. */
  const JAM_RADIUS = 4;
  const RUN_TICKS = 300;

  const gapNode = { hx: GAP.from, hy: WALL_ROW };
  const inGap = (hx: number): boolean => hx >= GAP.from && hx <= GAP.to;

  function scene(
    line: { tribe: number; hitpoints: number } = { tribe: UNARMED_TRIBE, hitpoints: STURDY_HP },
  ) {
    const { sim, terrain } = crowdSim(
      nodeMap(WIDTH, HEIGHT, (hx, hy) => hy === WALL_ROW && !inGap(hx) && hx < FAR_OPENING),
    );
    const fort = fortAt(sim, FORT_ANCHOR);
    const men: Entity[] = [];
    for (let hx = GAP.from; hx <= GAP.to; hx++)
      men.push(
        soldierOn(sim, { hx, hy: WALL_ROW }, DEFENDER, MILITARY_MODE.IGNORE, line.tribe, line.hitpoints),
      );
    const army = attackersFrom(sim, ARMY_FIRST, ARMY, ARMY_PER_ROW);
    return { sim, terrain, fort, line: men, army };
  }

  // An unarmed line never strikes and is too sturdy to fall to the men beside it: the routing alone shapes
  // the jam.
  it('walks the army up to the line and jams it there, never round the far opening', () => {
    const { sim, terrain, fort, line, army } = scene();
    orderAttack(sim, army, fort);
    const log = runLogged(sim, terrain, army, fort, RUN_TICKS, {
      strayed: (n) => n.hx >= FAR_HALF,
      anchor: gapNode,
      slack: DRIFT_SLACK,
      soldiers: [...army, ...line],
    });

    expect(line.every((e) => sim.world.isAlive(e) && inGap(nodeOf(sim, e).hx))).toBe(true);
    expect([...log.detours]).toEqual([]);
    expect([...log.drifted]).toEqual([]);
    expect([...log.lostOrder]).toEqual([]);
    expect([...log.shared]).toEqual([]);
    const away = army
      .filter((e) => sim.world.isAlive(e))
      .map((e) => ({ e, node: nodeOf(sim, e) }))
      .filter(({ node }) => hexDistanceBetween(node.hx, node.hy, gapNode.hx, gapNode.hy) > JAM_RADIUS);
    expect(away).toEqual([]);
  });

  /** Eight blows of the mace. */
  const GAP_MAN_HP = 400;
  /** More than the gap men deal the army over the run. */
  const ATTACKER_HP = 1000;
  const ARMED_RUN_TICKS = 400;

  it('strikes the armed men holding the gap from the jam, then walks through and strikes the fort', () => {
    const { sim, terrain, fort, line, army } = scene({ tribe: VIKING, hitpoints: GAP_MAN_HP });
    for (const e of army) {
      const health = sim.world.mut(e, Health);
      health.hitpoints = ATTACKER_HP;
      health.max = ATTACKER_HP;
    }
    orderAttack(sim, army, fort);
    const struckLine = new Set<Entity>();
    const struckFort = new Set<Entity>();
    const log = runLogged(sim, terrain, army, fort, ARMED_RUN_TICKS, {
      strayed: (n) => n.hx >= FAR_HALF,
      anchor: gapNode,
      // The army walks on through the gap to the fort, so no drift is held against it.
      slack: HEIGHT,
      soldiers: [...army, ...line],
      each: () => {
        for (const e of army) {
          const struck = sim.world.isAlive(e) ? striking(sim, e) : undefined;
          if (struck === fort) struckFort.add(e);
          else if (struck !== undefined && line.includes(struck)) struckLine.add(e);
        }
      },
    });

    expect(struckLine.size).toBeGreaterThan(0);
    expect(line.filter((e) => sim.world.isAlive(e))).toEqual([]);
    expect(army.filter((e) => !sim.world.isAlive(e))).toEqual([]);
    expect(army.filter((e) => !struckFort.has(e))).toEqual([]);
    expect([...log.detours]).toEqual([]);
    expect([...log.shared]).toEqual([]);
    expect(army.every((e) => holdsOrder(sim, e, fort))).toBe(true);
  });
});

describe('a group attack order on a building at the end of a narrow corridor', () => {
  // Half-cell nodes. The fort plugs a one-node wall of water; on the attackers' side a corridor two nodes
  // wide leads to its south face, its other faces are open only by a walk round the wall's far end:
  //
  //            ....                                     row 11, the fort's open north face
  //   ~~~~~~~~~~FF~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~      row 12, the fort's body at 10..11, opening 44..47
  //            ~FF~                                     row 13, the body's south row
  //            ~..~                                     rows 14..18, the corridor at 10..11
  //          AAAAAAAA                                   row 20, hx 7..14
  const WIDTH = 48;
  const HEIGHT = 24;
  const WALL_ROW = 12;
  const FORT_ANCHOR = { hx: 10, hy: WALL_ROW };
  const FAR_OPENING = 44;
  const CORRIDOR = {
    from: FORT_ANCHOR.hx,
    to: FORT_ANCHOR.hx + FORT_SIDE - 1,
    firstRow: WALL_ROW + FORT_SIDE,
    lastRow: 18,
  };
  const ARMY = 8;
  const ARMY_FIRST = { hx: 7, hy: 20 };
  const ARMY_PER_ROW = 8;
  /** How far past its start (map points from the corridor's head) a man may stand while the crowd settles. */
  const DRIFT_SLACK = 2;
  const SETTLE_TICKS = 300;
  /** How soon a waiting man steps onto a contact cell a front-rank man left. */
  const REFILL_TICKS = 40;

  const underFort = (hx: number): boolean => hx >= CORRIDOR.from && hx <= CORRIDOR.to;
  const corridorWall = (hx: number, hy: number): boolean =>
    hy > WALL_ROW && hy <= CORRIDOR.lastRow && (hx === CORRIDOR.from - 1 || hx === CORRIDOR.to + 1);
  const inCorridor = (n: Node): boolean =>
    underFort(n.hx) && n.hy >= CORRIDOR.firstRow && n.hy <= CORRIDOR.lastRow;

  function scene() {
    const { sim, terrain } = crowdSim(
      nodeMap(
        WIDTH,
        HEIGHT,
        (hx, hy) => (hy === WALL_ROW && hx < FAR_OPENING && !underFort(hx)) || corridorWall(hx, hy),
      ),
    );
    const fort = fortAt(sim, FORT_ANCHOR);
    const army = attackersFrom(sim, ARMY_FIRST, ARMY, ARMY_PER_ROW);
    return { sim, terrain, fort, army, body: bodyOf(sim, terrain, fort) };
  }

  it('queues the overflow in the corridor, never round the wall, and refills a freed contact cell', () => {
    const { sim, terrain, fort, army, body } = scene();
    orderAttack(sim, army, fort);
    const log = runLogged(sim, terrain, army, fort, SETTLE_TICKS, {
      strayed: (n) => n.hy < WALL_ROW,
      anchor: { hx: CORRIDOR.from, hy: CORRIDOR.firstRow },
      slack: DRIFT_SLACK,
      soldiers: army,
    });

    expect([...log.detours]).toEqual([]);
    expect([...log.drifted]).toEqual([]);
    expect([...log.lostOrder]).toEqual([]);
    expect([...log.shared]).toEqual([]);
    // The corridor holds the whole army, so the overflow waits inside it, not beside its walls.
    expect(army.map((e) => nodeOf(sim, e)).filter((n) => !inCorridor(n))).toEqual([]);

    const leaving = army.find((e) => reachTo(nodeOf(sim, e), body) === MACE_REACH);
    expect(leaving).toBeDefined();
    if (leaving === undefined) return;
    const left = nodeOf(sim, leaving);
    sim.world.destroy(leaving);
    const refilled = (): boolean =>
      army.some((e) => {
        if (!sim.world.isAlive(e) || sim.world.has(e, PathFollow)) return false;
        const n = nodeOf(sim, e);
        return n.hx === left.hx && n.hy === left.hy;
      });
    let ticks = 0;
    while (ticks < REFILL_TICKS && !refilled()) {
      sim.step();
      ticks++;
    }
    expect(refilled()).toBe(true);
  });

  it('steps a waiting man up into the place in the queue a man ahead of him left', () => {
    const { sim, fort, army, body } = scene();
    orderAttack(sim, army, fort);
    for (let tick = 0; tick < SETTLE_TICKS; tick++) sim.step();

    // A man queued out of reach with another queued behind him in his column.
    const queued = army.filter(
      (e) => inCorridor(nodeOf(sim, e)) && reachTo(nodeOf(sim, e), body) > MACE_REACH,
    );
    const ahead = queued.find((e) => {
      const n = nodeOf(sim, e);
      return queued.some((b) => nodeOf(sim, b).hx === n.hx && nodeOf(sim, b).hy > n.hy);
    });
    expect(ahead).toBeDefined();
    if (ahead === undefined) return;
    const left = nodeOf(sim, ahead);
    sim.world.destroy(ahead);
    const steppedUp = (): boolean =>
      army.some((e) => {
        if (!sim.world.isAlive(e) || sim.world.has(e, PathFollow)) return false;
        const n = nodeOf(sim, e);
        return n.hx === left.hx && n.hy === left.hy;
      });
    let ticks = 0;
    while (ticks < REFILL_TICKS && !steppedUp()) {
      sim.step();
      ticks++;
    }
    expect(steppedUp()).toBe(true);
    expect(sharedStands(sim, army)).toEqual([]);
  });
});

describe('a group attack order on a building in the open', () => {
  const WIDTH = 32;
  const HEIGHT = 24;
  const FORT_ANCHOR = { hx: 16, hy: 12 };
  const ARMY = 10;
  const ARMY_FIRST = { hx: 4, hy: 9 };
  const ARMY_PER_ROW = 2;
  const SETTLE_TICKS = 300;
  /** How many of the army stand in reach of the fort once it surrounds it. */
  const MIN_IN_REACH = 8;

  it('surrounds it on several faces, one man to a node', () => {
    const { sim, terrain } = crowdSim(grassNodeMap(WIDTH, HEIGHT));
    const fort = fortAt(sim, FORT_ANCHOR);
    const army = attackersFrom(sim, ARMY_FIRST, ARMY, ARMY_PER_ROW);
    const body = bodyOf(sim, terrain, fort);
    orderAttack(sim, army, fort);
    const shared = runSampled(sim, army, SETTLE_TICKS);

    const inReach = army.map((e) => nodeOf(sim, e)).filter((n) => reachTo(n, body) === MACE_REACH);
    expect(inReach.length).toBeGreaterThanOrEqual(MIN_IN_REACH);
    // The army came from the west: some of it must have walked round to the east face.
    const eastEdge = FORT_ANCHOR.hx + FORT_SIDE - 1;
    expect(inReach.some((n) => n.hx > eastEdge)).toBe(true);
    expect(inReach.some((n) => n.hx < FORT_ANCHOR.hx)).toBe(true);
    expect([...shared]).toEqual([]);
    expect(army.every((e) => holdsOrder(sim, e, fort))).toBe(true);
  });
});

describe('a group attack order on a building with a real body', () => {
  const WIDTH = 48;
  const HEIGHT = 40;
  const FORT_ANCHOR = { hx: 20, hy: 12 };
  const ARMY_FIRST = { hx: 2, hy: 6 };
  const ARMY_PER_ROW = 4;
  const SETTLE_TICKS = 500;

  /** The walkable nodes a map point from `body`: every face a mace strikes it from. */
  function ringOf(terrain: TerrainGraph, body: readonly Node[]): Node[] {
    const ring: Node[] = [];
    for (let hy = 0; hy < terrain.height; hy++) {
      for (let hx = 0; hx < terrain.width; hx++) {
        if (terrain.isWalkable(terrain.nodeAt(hx, hy)) && reachTo({ hx, hy }, body) === MACE_REACH)
          ring.push({ hx, hy });
      }
    }
    return ring;
  }

  /** The faces of `ring` an attacker stands on. */
  function mannedOf(sim: Simulation, army: readonly Entity[], ring: readonly Node[]): Node[] {
    const stands = new Set(army.map((e) => nodeOf(sim, e)).map((n) => `${n.hx},${n.hy}`));
    return ring.filter((n) => stands.has(`${n.hx},${n.hy}`));
  }

  it.each([
    ['six by seven', HALL, HALL_BODY],
    ['nine by nine', KEEP, KEEP_BODY],
  ])(
    'mans every face of a %s body round it and holds the rest waiting, one man to a node',
    (_, type, size) => {
      const { sim, terrain } = crowdSim(grassNodeMap(WIDTH, HEIGHT));
      const fort = fortAt(sim, FORT_ANCHOR, type);
      const body = bodyOf(sim, terrain, fort);
      const ring = ringOf(terrain, body);
      // More men than faces, all coming from the west.
      const army = attackersFrom(sim, ARMY_FIRST, ring.length + size.width, ARMY_PER_ROW);
      orderAttack(sim, army, fort);
      const shared = runSampled(sim, army, SETTLE_TICKS);

      expect(mannedOf(sim, army, ring)).toEqual(ring);
      const waiting = army.filter((e) => reachTo(nodeOf(sim, e), body) > MACE_REACH);
      expect(waiting.length).toBe(army.length - ring.length);
      expect(waiting.filter((e) => sim.world.tryGet(e, Engagement)?.waiting !== true)).toEqual([]);
      expect([...shared]).toEqual([]);
      expect(army.every((e) => holdsOrder(sim, e, fort))).toBe(true);
    },
  );

  it('leaves the faces across a wall alone and mans every one on its own side', () => {
    // Half-cell nodes. The hall's body, rows 16..22 at hx 20..25, plugs a one-node wall of water whose only
    // opening lies far east; the army comes from the south, more men than the faces on its side:
    //
    //        ......                       row 15, the hall's north faces, a walk round the far opening away
    //   ~~~~~HHHHHH~~~~~~~~~~~~~~~~~~~    row 20, the opening at 44..47
    //        ......                       row 23, its south faces
    //      AAAAAAAA                       the army from row 30
    const WALL_ROW = HEIGHT / 2;
    const FAR_OPENING = 44;
    const hall = { hx: 20, hy: WALL_ROW - 4 };
    const underHall = (hx: number): boolean => hx >= hall.hx && hx < hall.hx + HALL_BODY.width;
    const { sim, terrain } = crowdSim(
      nodeMap(WIDTH, HEIGHT, (hx, hy) => hy === WALL_ROW && hx < FAR_OPENING && !underHall(hx)),
    );
    const fort = fortAt(sim, hall, HALL);
    const body = bodyOf(sim, terrain, fort);
    const ring = ringOf(terrain, body);
    const ourSide = ring.filter((n) => n.hy > WALL_ROW);
    const army = attackersFrom(
      sim,
      { hx: hall.hx - 2, hy: 30 },
      ourSide.length + HALL_BODY.width,
      2 * ARMY_PER_ROW,
    );
    orderAttack(sim, army, fort);
    const log = runLogged(sim, terrain, army, fort, SETTLE_TICKS, {
      strayed: (n) => n.hy < WALL_ROW,
      anchor: { hx: hall.hx, hy: WALL_ROW },
      slack: HEIGHT,
      soldiers: army,
    });

    expect(mannedOf(sim, army, ring)).toEqual(ourSide);
    expect([...log.detours]).toEqual([]);
    expect([...log.lostOrder]).toEqual([]);
    expect([...log.shared]).toEqual([]);
  });
});

describe('a fight at an armed enemy line two ranks deep', () => {
  // Half-cell nodes. A closed line of armed enemies, two ranks deep, across the map; a crowd of attackers
  // with no order south of it:
  //
  //   EEEEEEEEEEEEEEEEEEEEEEEE      rows 20..21, every node
  //     AAAAAAAAAAAAAAAAAAAA        rows 23 and 25, hx 2..21
  const WIDTH = 24;
  const HEIGHT = 48;
  const RANKS = [20, 21];
  const FRONT_RANK = 21;
  const ARMY_ROWS = [23, 25];
  const ARMY_COLUMNS = { from: 2, to: 21 };
  const SETTLE_TICKS = 300;

  it('strikes the front rank from wherever it stands beside it, never holding out for the rank behind', () => {
    const { sim } = crowdSim(grassNodeMap(WIDTH, HEIGHT));
    const line: Entity[] = [];
    for (const hy of RANKS)
      for (let hx = 0; hx < WIDTH; hx++)
        line.push(soldierOn(sim, { hx, hy }, DEFENDER, MILITARY_MODE.IGNORE));
    const army: Entity[] = [];
    for (const hy of ARMY_ROWS)
      for (let hx = ARMY_COLUMNS.from; hx <= ARMY_COLUMNS.to; hx++)
        army.push(soldierOn(sim, { hx, hy }, ATTACKER, MILITARY_MODE.ATTACK));
    const shared = runSampled(sim, [...army, ...line], SETTLE_TICKS);

    const inReach = (e: Entity, t: Entity | undefined): boolean =>
      t !== undefined && sim.world.isAlive(t) && apart(sim, e, t) <= MACE_REACH;
    const touching = army.filter((e) => line.some((l) => inReach(e, l)));
    expect(touching.length).toBe(WIDTH);
    // Each holds a front-ranker in reach, and strikes him.
    const held = touching.map((e) => sim.world.tryGet(e, Engagement)?.target);
    expect(touching.filter((e, i) => !inReach(e, held[i]))).toEqual([]);
    const struck = held.filter((t): t is Entity => t !== undefined);
    expect(struck.filter((t) => nodeOf(sim, t).hy !== FRONT_RANK)).toEqual([]);
    expect(struck.filter((t) => sim.world.get(t, Health).hitpoints === STURDY_HP)).toEqual([]);
    expect([...shared]).toEqual([]);
  });
});

describe('a chaser routing keeps on his own node', () => {
  // Half-cell nodes. A corridor one node wide along row 4, water everywhere else:
  //
  //   E F N C . . . . . . . . . . . . . . . . . . . . . . . W    E the enemy, F a friend fighting him,
  //                                                               N free, C the chaser, W a friend far off
  //
  // W, ordered on E, asks first and is stood in on N, so routing keeps C on his node while W walks up; the
  // chase, which lets a nearer man take a farther friend's place, reads N as free beside him all along.
  const WIDTH = 48;
  const HEIGHT = 9;
  const ROW = 4;
  const ENEMY = 10;
  const FRONT = ENEMY + 1;
  const NEAR = ENEMY + 2;
  const CHASER = ENEMY + 3;
  const FAR = 44;
  /** Ticks for both chasers to take the enemy up and be routed. */
  const SETTLE_TICKS = 2 * REPATH_CADENCE;
  const WATCHED_STRIDES = 3;

  it('asks routing at most once a stride', () => {
    const { sim, terrain } = crowdSim(nodeMap(WIDTH, HEIGHT, (hx, hy) => hy !== ROW || hx < ENEMY));
    const enemy = soldierOn(sim, { hx: ENEMY, hy: ROW }, DEFENDER, MILITARY_MODE.IGNORE, UNARMED_TRIBE);
    soldierOn(sim, { hx: FRONT, hy: ROW }, ATTACKER, MILITARY_MODE.ATTACK);
    const far = soldierOn(sim, { hx: FAR, hy: ROW }, ATTACKER, MILITARY_MODE.ATTACK);
    const chaser = soldierOn(sim, { hx: CHASER, hy: ROW }, ATTACKER, MILITARY_MODE.ATTACK);
    // Ordered, as he stands out of sight; the chaser near by takes the enemy up himself.
    orderAttack(sim, [far], enemy);
    for (let tick = 0; tick < SETTLE_TICKS; tick++) sim.step();

    let asks = 0;
    for (let tick = 0; tick < WATCHED_STRIDES * REPATH_CADENCE; tick++) {
      sim.step();
      const goal = sim.world.tryGet(chaser, MoveGoal)?.cell;
      if (!sim.world.has(chaser, PathFollow) && goal !== undefined && terrain.xOf(goal) !== CHASER) asks++;
      expect(nodeOf(sim, chaser)).toEqual({ hx: CHASER, hy: ROW });
    }
    // The friend is still on his way to N, so routing refused C every time he asked.
    expect(nodeOf(sim, far).hx).toBeGreaterThan(NEAR);
    expect(asks).toBeGreaterThan(0);
    expect(asks).toBeLessThanOrEqual(WATCHED_STRIDES);
  });
});
