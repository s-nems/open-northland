import { describe, expect, it } from 'vitest';
import {
  addPerson,
  MoveGoal,
  Owner,
  PathFollow,
  PathRequest,
  PathRoute,
  PlayerOrder,
  Position,
  setDiplomacyStance,
  WALK_DIRECTION,
  WalkFacing,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
  exportSaveGame,
  fx,
  playerCommand,
  positionOfNode,
  restoreSimulation,
  Simulation,
  type TerrainMap,
} from '../../../src/index.js';
import { NodeMask } from '../../../src/nav/block-overlay.js';
import { columnStepMiddles, isColumnStep } from '../../../src/nav/pathfinding/index.js';
import { type NodeId, StepBuffer } from '../../../src/nav/terrain/index.js';
import { stampResourceFootprintData } from '../../../src/systems/footprint/index.js';
import { liveBandRoutes } from '../../../src/systems/movement/live-band-routes.js';
import { testContent } from '../../fixtures/content.js';

/** Four rows of 32: enough for the army's rows to share searched routes. The thousand-soldier scale
 *  lives in the slow-tier army-geometry suite. */
const MEMBERS = 128;
const WIDTH = 400;
const HEIGHT = 96;
const WALL_X = 120;
const GAP_Y = 76;
/** Fewest corridor stops a band rides after its own search met the corridor at the wall's gap. */
const MET_STRETCH_NODES = 20;
/** Ticks a band-mate has marched before a soldier is ordered after it. */
const LATE_ORDER_TICKS = 12;

function army(wall: boolean, wallHeight = GAP_Y) {
  const typeIds = new Array<number>(WIDTH * HEIGHT).fill(0);
  if (wall) for (let y = 0; y < wallHeight; y++) typeIds[y * WIDTH + WALL_X] = 1;
  const map: TerrainMap = { resolution: 'half-cell', width: WIDTH, height: HEIGHT, typeIds };
  const sim = new Simulation({ seed: 7, content: testContent(), map });
  const members: { entity: Entity; x: number; y: number }[] = [];
  for (let i = 0; i < MEMBERS; i++) {
    const x = 4 + (i % 32) * 2;
    const y = 4 + Math.floor(i / 32) * 2;
    const entity = sim.world.create();
    sim.world.add(entity, Position, positionOfNode(x, y));
    addPerson(sim.world, entity, {
      tribe: 1,
      jobType: 31,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
    });
    sim.world.add(entity, Owner, { player: 0 });
    sim.world.add(entity, WalkFacing, { direction: WALK_DIRECTION.E, target: WALK_DIRECTION.E });
    members.push({ entity, x, y });
  }
  return { sim, members };
}

/** A standing enemy soldier on every node of the wall column. */
function enemyLine(sim: Simulation): Entity[] {
  const posts: Entity[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    const post = sim.world.create();
    sim.world.add(post, Position, positionOfNode(WALL_X, y));
    addPerson(sim.world, post, {
      tribe: 1,
      jobType: 31,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
    });
    sim.world.add(post, Owner, { player: 1 });
    posts.push(post);
  }
  return posts;
}

describe('army player routing', () => {
  it(`rejects ${MEMBERS} statically disconnected orders`, () => {
    const { sim, members } = army(true, HEIGHT);
    for (const { entity, x, y } of members)
      sim.enqueue(playerCommand(0, { kind: 'attackMoveUnit', entity, x: x + 240, y }));
    sim.step();
    for (const { entity } of members) expect(sim.world.get(entity, PathRequest).failed).toBe(true);
  });

  it(`rejects ${MEMBERS} orders into a tiny sealed goal`, () => {
    const { sim, members } = army(false);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('army terrain missing');
    const goalX = 300,
      goalY = 70;
    const wall = sim.world.create();
    sim.world.add(wall, Position, positionOfNode(goalX, goalY));
    const neighbours = new StepBuffer();
    terrain.stepsInto(terrain.nodeAt(goalX, goalY), undefined, neighbours);
    stampResourceFootprintData(sim.world, wall, {
      walk: Array.from({ length: neighbours.length }, (_, i) => ({
        dx: terrain.xOf(neighbours.nodeAt(i)) - goalX,
        dy: terrain.yOf(neighbours.nodeAt(i)) - goalY,
      })),
      build: [],
      work: [],
    });
    for (const { entity } of members)
      sim.enqueue(playerCommand(0, { kind: 'attackMoveUnit', entity, x: goalX, y: goalY }));
    sim.step();
    for (const { entity } of members) expect(sim.world.get(entity, PathRequest).failed).toBe(true);
  });

  it.each(['structure', 'soldiers'] as const)(
    'rejects every order across a closed %s wall, and a line of soldiers lets them through once it leaves',
    (wallKind) => {
      const { sim, members } = army(false);
      const posts: Entity[] = [];
      if (wallKind === 'structure') {
        const wall = sim.world.create();
        sim.world.add(wall, Position, positionOfNode(WALL_X, 0));
        stampResourceFootprintData(sim.world, wall, {
          walk: Array.from({ length: HEIGHT }, (_, dy) => ({ dx: 0, dy })),
          build: [],
          work: [],
        });
      } else {
        posts.push(...enemyLine(sim));
      }
      // An attack-move routes through an enemy line, so only a plain move is refused at one.
      const kind = wallKind === 'soldiers' ? 'moveUnit' : 'attackMoveUnit';
      for (const { entity, x, y } of members) sim.enqueue(playerCommand(0, { kind, entity, x: x + 240, y }));
      sim.step();
      for (const { entity } of members) {
        expect(sim.world.get(entity, PathRequest).failed).toBe(true);
        expect(sim.world.has(entity, PathFollow)).toBe(false);
      }
      if (wallKind === 'soldiers') {
        for (const post of posts) sim.world.destroy(post);
        for (const { entity, x, y } of members)
          sim.enqueue(playerCommand(0, { kind, entity, x: x + 240, y }));
        sim.step();
        for (const { entity } of members) {
          expect(sim.world.has(entity, PathRequest)).toBe(false);
          expect(sim.world.has(entity, PathFollow)).toBe(true);
        }
      }
    },
  );

  it('refuses an attack-move through the line of a side that is its enemy but not its target', () => {
    const { sim, members } = army(false);
    // Player 1 holds player 0 an enemy, so its line blocks player 0, who holds it a friend and never
    // fights it.
    setDiplomacyStance(sim.world, 0, 1, 'friend');
    enemyLine(sim);
    const [member] = members;
    if (member === undefined) throw new Error('army missing');
    sim.enqueue(
      playerCommand(0, { kind: 'attackMoveUnit', entity: member.entity, x: member.x + 240, y: member.y }),
    );
    sim.step();
    expect(sim.world.get(member.entity, PathRequest).failed).toBe(true);
  });

  it('routes every attack-move through a closed line of enemy soldiers', () => {
    const { sim, members } = army(false);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('army terrain missing');
    enemyLine(sim);
    for (const { entity, x, y } of members)
      sim.enqueue(playerCommand(0, { kind: 'attackMoveUnit', entity, x: x + 240, y }));
    sim.step();
    for (const { entity, x, y } of members) {
      expect(sim.world.has(entity, PathRequest)).toBe(false);
      expect(sim.world.get(entity, PathRoute).waypoints.at(-1)?.node).toBe(terrain.nodeAt(x + 240, y));
    }
  });

  it.each(['moveUnit', 'attackMoveUnit'] as const)(
    'starts every local %s order in its application tick and replaces every route on redirect',
    (kind) => {
      const { sim, members } = army(false);
      for (const { entity, x, y } of members) sim.enqueue(playerCommand(0, { kind, entity, x: x + 24, y }));
      sim.step();
      expect(members.filter(({ entity }) => sim.world.has(entity, PathRequest))).toEqual([]);
      for (const { entity, x, y } of members) {
        expect(sim.world.has(entity, PlayerOrder)).toBe(true);
        expect(sim.world.has(entity, PathFollow)).toBe(true);
        expect(sim.world.get(entity, Position).x).toBeGreaterThan(positionOfNode(x, y).x);
        expect(sim.world.get(entity, PathRoute).waypoints.at(-1)?.node).toBe(sim.terrain?.nodeAt(x + 24, y));
      }
      for (const { entity, x, y } of members) sim.enqueue(playerCommand(0, { kind, entity, x: x - 2, y }));
      sim.step();
      expect(members.filter(({ entity }) => sim.world.has(entity, PathRequest))).toEqual([]);
      for (const { entity, x, y } of members) {
        const goal = sim.terrain?.nodeAt(x - 2, y);
        expect(sim.world.get(entity, MoveGoal).cell).toBe(goal);
        expect(sim.world.get(entity, PathRoute).waypoints.at(-1)?.node).toBe(goal);
      }
    },
  );

  it.each([false, true])('starts every long attack-move route in the application tick (wall=%s)', (wall) => {
    const { sim, members } = army(wall);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('army terrain missing');
    for (const { entity, x, y } of members)
      sim.enqueue(playerCommand(0, { kind: 'attackMoveUnit', entity, x: x + 240, y }));
    sim.step();
    expect(members.filter(({ entity }) => sim.world.has(entity, PathRequest))).toEqual([]);
    for (const { entity, x, y } of members) {
      const route = sim.world.get(entity, PathRoute).waypoints;
      expect(route.at(-1)?.node).toBe(terrain.nodeAt(x + 240, y));
      if (wall) expect(route.some(({ node }) => terrain.yOf(node) >= GAP_Y)).toBe(true);
      // Diagonal interpolation stops also carry a pacing node; only lattice centres are route nodes.
      const centres = route.filter((stop) => {
        const at = positionOfNode(terrain.xOf(stop.node), terrain.yOf(stop.node));
        return stop.x === at.x && stop.y === at.y;
      });
      expect(centres.every(({ node }) => terrain.isWalkable(node))).toBe(true);
      expect(sim.world.get(entity, PathFollow).legCost).toBeGreaterThan(0);
    }
  });

  it("takes up the leaders' corridor where the search of a band standing beyond the shared area meets it", () => {
    const width = 400;
    const height = 160;
    const typeIds = new Array<number>(width * height).fill(0);
    // A wall whose one gap lies far below the march, so no member walks a straight or shifted lane.
    const wallX = 200;
    const gapRows = { from: 150, to: 154 };
    for (let y = 0; y < height; y++) if (y < gapRows.from || y > gapRows.to) typeIds[y * width + wallX] = 1;
    const map: TerrainMap = { resolution: 'half-cell', width, height, typeIds };
    const sim = new Simulation({ seed: 7, content: testContent(), map });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('army terrain missing');
    const bandSize = 10;
    // The far band stands well past GROUP_AREA_RADIUS_NODES of the leaders' road.
    const bandRows = [4, 120];
    const targetX = 340;
    const targetY = 8;
    const members: { entity: Entity; goal: NodeId }[] = [];
    for (const row of bandRows) {
      for (let i = 0; i < bandSize; i++) {
        const entity = sim.world.create();
        sim.world.add(entity, Position, positionOfNode(4 + i * 2, row));
        addPerson(sim.world, entity, {
          tribe: 1,
          jobType: 31,
          hunger: fx.fromInt(0),
          fatigue: fx.fromInt(0),
          piety: fx.fromInt(0),
          enjoyment: fx.fromInt(0),
        });
        sim.world.add(entity, Owner, { player: 0 });
        sim.world.add(entity, WalkFacing, { direction: WALK_DIRECTION.E, target: WALK_DIRECTION.E });
        members.push({
          entity,
          goal: terrain.nodeAt(
            targetX + (members.length % bandSize) * 2,
            targetY + 2 * Math.floor(members.length / bandSize),
          ),
        });
      }
    }
    sim.enqueue(
      playerCommand(0, {
        kind: 'attackMoveUnitGroup',
        members: members.map(({ entity, goal }) => ({ entity, x: terrain.xOf(goal), y: terrain.yOf(goal) })),
      }),
    );
    sim.step();
    const [leader] = members;
    if (leader === undefined) throw new Error('band missing');
    const leaderRoute = new Set(sim.world.get(leader.entity, PathRoute).waypoints.map(({ node }) => node));
    // The far band walks its own way to the gap and rides the leaders' corridor from there until a
    // straight lane to its slots opens.
    for (const { entity } of members.slice(bandSize)) {
      const shared = sim.world.get(entity, PathRoute).waypoints.filter(({ node }) => leaderRoute.has(node));
      expect(shared.length).toBeGreaterThan(MET_STRETCH_NODES);
    }
    for (const { entity, goal } of members) {
      expect(sim.world.has(entity, PathRequest)).toBe(false);
      const route = sim.world.get(entity, PathRoute).waypoints;
      expect(route.at(-1)?.node).toBe(goal);
      // Diagonal interpolation stops also carry a pacing node; only lattice centres are route nodes.
      const centres = route.filter((stop) => {
        const at = positionOfNode(terrain.xOf(stop.node), terrain.yOf(stop.node));
        return stop.x === at.x && stop.y === at.y;
      });
      expect(centres.every(({ node }) => terrain.isWalkable(node))).toBe(true);
    }
  });
  it('offers a soldier ordered later the route a band-mate still walks, the same after a restore', () => {
    const width = 400;
    const height = 160;
    const typeIds = new Array<number>(width * height).fill(0);
    const wallX = 200;
    const gapRows = { from: 150, to: 154 };
    for (let y = 0; y < height; y++) if (y < gapRows.from || y > gapRows.to) typeIds[y * width + wallX] = 1;
    const map: TerrainMap = { resolution: 'half-cell', width, height, typeIds };
    const sim = new Simulation({ seed: 7, content: testContent(), map });
    const soldier = (x: number, y: number, player: number): Entity => {
      const entity = sim.world.create();
      sim.world.add(entity, Position, positionOfNode(x, y));
      addPerson(sim.world, entity, {
        tribe: 1,
        jobType: 31,
        hunger: fx.fromInt(0),
        fatigue: fx.fromInt(0),
        piety: fx.fromInt(0),
        enjoyment: fx.fromInt(0),
      });
      sim.world.add(entity, Owner, { player });
      sim.world.add(entity, WalkFacing, { direction: WALK_DIRECTION.E, target: WALK_DIRECTION.E });
      return entity;
    };
    const leader = soldier(4, 4, 0);
    const stranger = soldier(4, 20, 1);
    const late = soldier(8, 6, 0);
    sim.enqueue(playerCommand(0, { kind: 'attackMoveUnit', entity: leader, x: 340, y: 8 }));
    sim.enqueue(playerCommand(1, { kind: 'attackMoveUnit', entity: stranger, x: 340, y: 20 }));
    for (let tick = 0; tick < LATE_ORDER_TICKS; tick++) sim.step();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('army terrain missing');
    const blocked = new NodeMask(terrain.nodeCount);
    const live = liveBandRoutes(sim.world, sim.content, terrain, late, 0, true, true, blocked);
    // The leader's route alone: the stranger marches for another player.
    expect(live).toHaveLength(1);
    const [route] = live;
    if (route === undefined) throw new Error('live route missing');
    const ahead = sim.world.get(leader, PathRoute).waypoints.slice(sim.world.get(leader, PathFollow).index);
    expect(route[0]).toBe(ahead[0]?.node);
    expect(route.at(-1)).toBe(terrain.nodeAt(340, 8));
    for (let i = 1; i < route.length; i++) {
      expect(terrain.joined(route[i - 1] as NodeId, route[i] as NodeId)).toBe(true);
    }
    expect(liveBandRoutes(sim.world, sim.content, terrain, leader, 0, true, true, blocked)).toEqual([]);

    const order = playerCommand(0, { kind: 'attackMoveUnit', entity: late, x: 344, y: 10 });
    const restored = restoreSimulation(exportSaveGame(sim), { content: sim.content, map });
    sim.enqueue(order);
    restored.enqueue(order);
    sim.step();
    restored.step();
    const taken = sim.world.get(late, PathRoute).waypoints;
    expect(taken.at(-1)?.node).toBe(terrain.nodeAt(344, 10));
    expect(restored.world.get(late, PathRoute).waypoints).toEqual(taken);
  });

  it('routes a band whose boarding leg is refused alone, and its own band joins that route', () => {
    const width = 400;
    const height = 160;
    const typeIds = new Array<number>(width * height).fill(0);
    // A wall between the leaders' road and the far band, open only at the map's far end, so the far band's
    // leg onto the leaders' corridor is no straight hop and boarding refuses it.
    const wallY = 60;
    const gapColumns = { from: 390, to: 394 };
    for (let x = 0; x < width; x++)
      if (x < gapColumns.from || x > gapColumns.to) typeIds[wallY * width + x] = 1;
    const map: TerrainMap = { resolution: 'half-cell', width, height, typeIds };
    const sim = new Simulation({ seed: 7, content: testContent(), map });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('army terrain missing');
    const bandSize = 10;
    const bandRows = [4, 120];
    const targetX = 340;
    const targetY = 8;
    const members: { entity: Entity; goal: NodeId }[] = [];
    for (const row of bandRows) {
      for (let i = 0; i < bandSize; i++) {
        const entity = sim.world.create();
        sim.world.add(entity, Position, positionOfNode(4 + i * 2, row));
        addPerson(sim.world, entity, {
          tribe: 1,
          jobType: 31,
          hunger: fx.fromInt(0),
          fatigue: fx.fromInt(0),
          piety: fx.fromInt(0),
          enjoyment: fx.fromInt(0),
        });
        sim.world.add(entity, Owner, { player: 0 });
        sim.world.add(entity, WalkFacing, { direction: WALK_DIRECTION.E, target: WALK_DIRECTION.E });
        members.push({
          entity,
          goal: terrain.nodeAt(
            targetX + (members.length % bandSize) * 2,
            targetY + 2 * Math.floor(members.length / bandSize),
          ),
        });
      }
    }
    sim.enqueue(
      playerCommand(0, {
        kind: 'attackMoveUnitGroup',
        members: members.map(({ entity, goal }) => ({ entity, x: terrain.xOf(goal), y: terrain.yOf(goal) })),
      }),
    );
    sim.step();
    const routeNodes = (entity: Entity): NodeId[] =>
      sim.world.get(entity, PathRoute).waypoints.map(({ node }) => node);
    for (const { entity, goal } of members) {
      expect(sim.world.has(entity, PathRequest)).toBe(false);
      expect(routeNodes(entity).at(-1)).toBe(goal);
    }
    const farBand = members.slice(bandSize);
    const [farLeader] = farBand;
    if (farLeader === undefined) throw new Error('far band missing');
    const farLeaderRoute = new Set(routeNodes(farLeader.entity));
    for (const { entity } of farBand) {
      const route = routeNodes(entity);
      // Through the gap, never across the wall: a stop in the gap, or a column step passing between gap nodes.
      const inGap = (node: NodeId | undefined): boolean =>
        node !== undefined && terrain.yOf(node) === wallY && terrain.xOf(node) >= gapColumns.from;
      expect(
        route.some((node, i) => {
          const previous = route[i - 1];
          if (inGap(node)) return true;
          if (previous === undefined || !isColumnStep(terrain, previous, node)) return false;
          return columnStepMiddles(terrain, previous, node).some(inGap);
        }),
      ).toBe(true);
      // The band rides its own leader's searched route rather than searching one each.
      expect(route.filter((node) => farLeaderRoute.has(node)).length).toBeGreaterThan(route.length / 2);
    }
  });
});
