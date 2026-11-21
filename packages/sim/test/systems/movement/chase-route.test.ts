import { describe, expect, it } from 'vitest';
import {
  Engagement,
  engagementRecord,
  Health,
  MoveGoal,
  Owner,
  PathFollow,
  PathRequest,
  PathRoute,
  Position,
  StandIn,
} from '../../../src/components/index.js';
import { setPeaceTime } from '../../../src/components/rules.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, hexDistanceBetween, positionOfNode, Simulation, type TerrainMap } from '../../../src/index.js';
import type { BlockOverlay } from '../../../src/nav/block-overlay.js';
import { hexNeighboursOf } from '../../../src/nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../src/nav/terrain/index.js';
import { drainPathRequests } from '../../../src/systems/index.js';
import { ChaseStands } from '../../../src/systems/movement/chase-route.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { addSettlerOfTribe } from '../../fixtures/settler.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

// A collider's chase routes by the structures and weighs the standing bodies it fights after: it walks round
// a body that costs a few nodes, walks up to a line that seals its way, and ends on a free node beside the
// end of its walk.

const VIKING = 1;
/** `soldier_unarmed`: a fighter trade, so its body collides and a standing one blocks an enemy's route. */
const SOLDIER = 31;
const P0 = 0;
const P1 = 1;
const GRASS = 0;
const WATER = 1;
const BUDGET = 1 << 20;
const HP = 1000;
const PEACE_TICKS = 1000;

interface Node {
  readonly hx: number;
  readonly hy: number;
}

function routing(map: TerrainMap): { sim: Simulation; terrain: TerrainGraph } {
  const sim = new Simulation({ seed: 1, content: testContent(), map });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('fixture: routing needs a map');
  return { sim, terrain };
}

/** A half-cell node map of grass with water wherever `water` answers true. */
function nodeMap(width: number, height: number, water: (hx: number, hy: number) => boolean): TerrainMap {
  const typeIds: number[] = [];
  for (let hy = 0; hy < height; hy++)
    for (let hx = 0; hx < width; hx++) typeIds.push(water(hx, hy) ? WATER : GRASS);
  return { ...grassNodeMap(width, height), typeIds };
}

/** A standing soldier of `owner` on `at`: a body that blocks the routes of the players at war with it. */
function soldier(sim: Simulation, at: Node, owner: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(at.hx, at.hy));
  addSettlerOfTribe(sim, e, {
    tribe: VIKING,
    jobType: SOLDIER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Health, { hitpoints: HP, max: HP });
  sim.world.add(e, Owner, { player: owner });
  return e;
}

/** `e` asking for a route to `goal`, as a chase when `chasing`. */
function ask(sim: Simulation, terrain: TerrainGraph, e: Entity, goal: Node, chasing = true): void {
  const p = sim.world.get(e, Position);
  const from = { hx: 0, hy: 0 };
  for (let hy = 0; hy < terrain.height; hy++)
    for (let hx = 0; hx < terrain.width; hx++) {
      const c = positionOfNode(hx, hy);
      if (c.x === p.x && c.y === p.y) Object.assign(from, { hx, hy });
    }
  if (chasing) sim.world.add(e, Engagement, engagementRecord(sim.tick));
  sim.world.add(e, PathRequest, {
    start: terrain.nodeAt(from.hx, from.hy),
    goal: terrain.nodeAt(goal.hx, goal.hy),
    failed: false,
  });
}

function route(sim: Simulation, terrain: TerrainGraph, e: Entity): Node[] {
  return sim.world
    .get(e, PathRoute)
    .waypoints.map((w) => ({ hx: terrain.xOf(w.node), hy: terrain.yOf(w.node) }));
}

function drain(sim: Simulation, terrain: TerrainGraph): void {
  drainPathRequests(sim.world, ctxOf(sim), terrain, BUDGET);
}

const nodeIs = (terrain: TerrainGraph, node: NodeId, at: Node): boolean =>
  terrain.xOf(node) === at.hx && terrain.yOf(node) === at.hy;

describe('a chase route past standing enemy bodies', () => {
  // A one-node wall of water across the map at WALL_ROW, a two-node gap held by enemies near the chaser,
  // and an opening at the far end, a walk several times longer.
  const WIDTH = 40;
  const HEIGHT = 16;
  const WALL_ROW = 8;
  const GAP = [10, 11];
  const FAR_OPENING = 36;
  const FROM = { hx: 10, hy: 12 };
  const GOAL = { hx: 10, hy: 4 };
  /** The stops of the walk up to the line: the chaser stands four rows short of it. */
  const UP_TO_THE_LINE = 4;

  function scene() {
    const { sim, terrain } = routing(
      nodeMap(WIDTH, HEIGHT, (hx, hy) => hy === WALL_ROW && !GAP.includes(hx) && hx < FAR_OPENING),
    );
    for (const hx of GAP) soldier(sim, { hx, hy: WALL_ROW }, P1);
    const chaser = soldier(sim, FROM, P0);
    return { sim, terrain, chaser };
  }

  it('walks up to a line that seals the way instead of round the far opening, and stands in before it', () => {
    const { sim, terrain, chaser } = scene();
    ask(sim, terrain, chaser, GOAL);
    drain(sim, terrain);

    const stops = route(sim, terrain, chaser);
    expect(stops.every((n) => n.hy > WALL_ROW)).toBe(true);
    expect(stops.length).toBe(UP_TO_THE_LINE);
    const end = stops.at(-1);
    expect(end?.hy).toBe(WALL_ROW + 1);
    expect(sim.world.get(chaser, StandIn)).toEqual({
      goal: terrain.nodeAt(GOAL.hx, GOAL.hy),
      at: terrain.nodeAt(end?.hx ?? 0, end?.hy ?? 0),
    });
  });

  it('goes round a line it holds a peace with, which it cannot fight its way through', () => {
    const { sim, terrain, chaser } = scene();
    setPeaceTime(sim.world, sim.tick, sim.tick + PEACE_TICKS, [P0, P1]);
    ask(sim, terrain, chaser, GOAL);
    drain(sim, terrain);

    const stops = route(sim, terrain, chaser);
    expect(stops.at(-1)).toEqual(GOAL);
    expect(Math.max(...stops.map((n) => n.hx))).toBeGreaterThan(WIDTH / 2);
  });

  it('leaves a walk that is no chase to its way round the line', () => {
    const { sim, terrain, chaser } = scene();
    ask(sim, terrain, chaser, GOAL, false);
    drain(sim, terrain);

    const stops = route(sim, terrain, chaser);
    expect(stops.at(-1)).toEqual(GOAL);
    expect(Math.max(...stops.map((n) => n.hx))).toBeGreaterThan(WIDTH / 2);
  });
});

describe('a chase route past a lone enemy body', () => {
  it('walks round it to its goal', () => {
    const { sim, terrain } = routing(grassNodeMap(30, 12));
    const body = { hx: 10, hy: 6 };
    soldier(sim, body, P1);
    const chaser = soldier(sim, { hx: 4, hy: 6 }, P0);
    const goal = { hx: 16, hy: 6 };
    ask(sim, terrain, chaser, goal);
    drain(sim, terrain);

    const stops = route(sim, terrain, chaser);
    expect(stops.at(-1)).toEqual(goal);
    expect(stops.some((n) => n.hx === body.hx && n.hy === body.hy)).toBe(false);
    expect(sim.world.has(chaser, StandIn)).toBe(false);
  });
});

describe('a chase route whose way round a body comes back through the node past it', () => {
  it('still weighs the bodies further on', () => {
    // A walk along one row. The node past the first body opens only onto the route's next node, so the way
    // round enters it from there and the loop is cut out of the route. An enemy shares the asker's node.
    const ROW = 10;
    const START = 2;
    const END = 14;
    const FIRST_BODY = 4;
    const PAST_IT = { hx: FIRST_BODY + 1, hy: ROW };
    const LATER_BODY = 10;
    const { sim, terrain } = routing(grassNodeMap(20, 20));
    const at = (n: Node): NodeId => terrain.nodeAt(n.hx, n.hy);
    const bodies = new Set<NodeId>([
      at({ hx: START, hy: ROW }),
      at({ hx: LATER_BODY, hy: ROW }),
      ...hexNeighboursOf(PAST_IT.hx, PAST_IT.hy)
        .filter((n) => !(n.hx === PAST_IT.hx + 1 && n.hy === ROW))
        .map(at),
    ]);
    const none: BlockOverlay = { has: () => false, size: 0 };
    const direct: NodeId[] = [];
    for (let hx = START; hx <= END; hx++) direct.push(at({ hx, hy: ROW }));
    const stands = new ChaseStands(terrain);
    stands.begin({
      world: sim.world,
      content: ctxOf(sim).content,
      requests: [],
      standIns: new Set(),
      doorways: new Set(),
    });
    const routed = stands.route(
      {
        asker: sim.world.create(),
        player: P0,
        start: direct[0] as NodeId,
        toward: direct.at(-1) as NodeId,
        ownNode: undefined,
        structures: none,
        bodies,
        occupied: bodies,
      },
      direct,
      { explored: 0 },
    );

    expect(routed?.slice(1).filter((n) => bodies.has(n))).toEqual([]);
    expect(routed?.at(-1)).toBe(direct.at(-1));
  });
});

describe("a chase's stand-in for a taken goal", () => {
  it('is a free node on its own side of an enemy line, never the nearer one across it', () => {
    // An enemy line across row LINE_ROW. The goal just south of it is a friend's, and so are the nodes
    // round it for FRIEND_ROWS rows: the nearest free node by map lies across the line, two points off,
    // and by walking behind the friends.
    const WIDTH = 24;
    const LINE_ROW = 8;
    const GOAL = { hx: 10, hy: LINE_ROW + 1 };
    const FRIEND_ROWS = 3;
    const FRIENDS = { from: 6, to: 14 };
    const { sim, terrain } = routing(grassNodeMap(WIDTH, 16));
    for (let hx = 0; hx < WIDTH; hx++) soldier(sim, { hx, hy: LINE_ROW }, P1);
    for (let hy = GOAL.hy; hy < GOAL.hy + FRIEND_ROWS; hy++)
      for (let hx = FRIENDS.from; hx <= FRIENDS.to; hx++) soldier(sim, { hx, hy }, P0);
    const chaser = soldier(sim, { hx: 10, hy: 14 }, P0);
    ask(sim, terrain, chaser, GOAL);
    drain(sim, terrain);

    const at = sim.world.get(chaser, StandIn).at;
    expect(terrain.yOf(at)).toBe(GOAL.hy + FRIEND_ROWS);
    expect(hexDistanceBetween(terrain.xOf(at), terrain.yOf(at), GOAL.hx, GOAL.hy)).toBe(FRIEND_ROWS);
  });

  it('is never the node a chaser standing still while it asks in the same drain stands on', () => {
    const { sim, terrain } = routing(grassNodeMap(24, 16));
    const goal = { hx: 10, hy: 6 };
    soldier(sim, goal, P0);
    // The asker comes first in the drain; the stander's node is the stand-in it would take otherwise:
    // beside the goal, the lowest id.
    const asker = soldier(sim, { hx: 10, hy: 12 }, P0);
    const besides = hexNeighboursOf(goal.hx, goal.hy).map((n) => terrain.nodeAt(n.hx, n.hy));
    const first = Math.min(...besides) as NodeId;
    const stander = soldier(sim, { hx: terrain.xOf(first), hy: terrain.yOf(first) }, P0);
    ask(sim, terrain, asker, goal);
    ask(sim, terrain, stander, goal);
    drain(sim, terrain);

    const at = sim.world.get(asker, StandIn).at;
    expect(nodeIs(terrain, at, { hx: terrain.xOf(first), hy: terrain.yOf(first) })).toBe(false);
    expect(besides).toContain(at);
  });

  it("is never the node a friend's chase walks to, for a grind reroute too", () => {
    // Friends stand on the goal and every node beside it but one, the end of a friend's chase route.
    const { sim, terrain } = routing(grassNodeMap(24, 16));
    const goal = { hx: 10, hy: 6 };
    const [open, ...taken] = hexNeighboursOf(goal.hx, goal.hy);
    if (open === undefined) throw new Error('fixture: the goal needs neighbours');
    for (const at of [goal, ...taken]) soldier(sim, at, P0);
    const walker = soldier(sim, { hx: 10, hy: 14 }, P0);
    ask(sim, terrain, walker, open);
    drain(sim, terrain);
    sim.world.add(walker, MoveGoal, { cell: terrain.nodeAt(open.hx, open.hy) });
    expect(sim.world.has(walker, PathFollow)).toBe(true);
    expect(route(sim, terrain, walker).at(-1)).toEqual(open);

    const grinder = soldier(sim, { hx: 4, hy: 6 }, P0);
    ask(sim, terrain, grinder, goal);
    sim.world.mut(grinder, PathRequest).grind = true;
    drain(sim, terrain);

    const end = route(sim, terrain, grinder).at(-1);
    expect(end).toBeDefined();
    expect(end).not.toEqual(open);
    expect([goal, ...taken]).not.toContainEqual(end);
  });
});
