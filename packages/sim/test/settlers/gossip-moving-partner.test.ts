import { expect, it } from 'vitest';
import {
  Chat,
  CurrentAtomic,
  MoveGoal,
  PathFollow,
  PathRequest,
  Position,
  Resource,
  ResourceFootprint,
  Settler,
  setSettlerJob,
  Wedding,
} from '../../src/components/index.js';
import { fx, nodeOfPosition, positionOfNode, Simulation } from '../../src/index.js';
import { findPath } from '../../src/nav/pathfinding/index.js';
import { driveWeddings, startWedding } from '../../src/systems/family/weddings.js';
import { dynamicBlockOverlay } from '../../src/systems/footprint/index.js';
import { pathfindingSystem } from '../../src/systems/movement/routing.js';
import { movementSystem } from '../../src/systems/movement/system.js';
import { navigationPlanner } from '../../src/systems/settlers/planner/navigation.js';
import { GossipCandidates } from '../../src/systems/social/gossip/candidates.js';
import { gossipSystem } from '../../src/systems/social/gossip/drive.js';
import { planGossipSeek } from '../../src/systems/social/gossip/plan.js';
import { ownedWoodcutter } from '../conflict/orders/support.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf, fixtureTick, nextTickCtxOf } from '../fixtures/context.js';
import { setNeeds } from '../fixtures/settler.js';
import { grassNodeMap } from '../fixtures/terrain.js';

it.each(['water', 'resource'] as const)(
  'meets a moving partner on safe ground beside a %s flank',
  (flank) => {
    const map = grassNodeMap(16, 16);
    const typeIds = [...map.typeIds];
    if (flank === 'water') typeIds[5 * 16 + 4] = 1;
    const s = new Simulation({ seed: 1, content: testContent(), map: { ...map, typeIds } });
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('mapped sim');
    if (flank === 'resource') {
      const block = s.world.create();
      s.world.add(block, Position, positionOfNode(4, 5));
      s.world.add(block, Resource, { goodType: 3, remaining: 10, harvestAtomic: 25 });
      s.world.add(block, ResourceFootprint, { walk: [{ dx: 0, dy: 0 }], build: [], work: [] });
    }
    const a = ownedWoodcutter(s, 0, 0);
    s.world.add(a, Position, positionOfNode(10, 8));
    setNeeds(s, a, { enjoyment: fx.fromInt(1) });
    const b = ownedWoodcutter(s, 0, 0);
    setSettlerJob(s.world, b, 6);
    s.world.add(b, Position, positionOfNode(4, 4));
    s.world.add(b, MoveGoal, { cell: terrain.nodeAt(6, 8) });
    navigationPlanner(s.world, terrain);
    pathfindingSystem(s.world, ctxOf(s));
    for (let i = 0; i < 30; i++) {
      movementSystem(s.world, nextTickCtxOf(s));
      const p = s.world.get(b, Position);
      const n = nodeOfPosition(p.x, p.y);
      const node = terrain.nodeAt(n.hx, n.hy);
      if (!terrain.isWalkable(node) || dynamicBlockOverlay(s.world, ctxOf(s), terrain).has(node)) break;
    }
    expect(s.world.has(b, PathFollow)).toBe(true);
    expect(
      findPath(
        terrain,
        terrain.nodeAt(10, 8),
        terrain.nodeAt(4, 4),
        dynamicBlockOverlay(s.world, ctxOf(s), terrain),
      ),
    ).not.toBeNull();
    const before = { ...s.world.get(b, Position) };
    expect(nodeOfPosition(before.x, before.y)).toEqual({ hx: 4, hy: 5 });
    expect(
      planGossipSeek(
        s.world,
        ctxOf(s),
        a,
        s.world.get(a, Settler),
        10,
        8,
        new GossipCandidates(s.world, s.content),
      ),
    ).toBe(true);
    gossipSystem(s.world, ctxOf(s));
    expect(s.world.has(b, PathFollow)).toBe(true);
    expect(s.world.get(b, Position)).toEqual(before);
    expect(s.world.has(a, MoveGoal)).toBe(false);
    // The isolated movement setup has already executed these ticks; resume the full schedule after them.
    s.restoreTick(fixtureTick(s));
    let talking = false;
    for (let tick = 0; tick < 100 && !talking; tick++) {
      s.step();
      expect(s.world.tryGet(a, PathRequest)?.failed).not.toBe(true);
      expect(s.events.current().some((event) => event.kind === 'settlerLost')).toBe(false);
      talking = s.world.tryGet(a, Chat)?.talking === true;
    }
    expect(talking).toBe(true);
    for (const e of [a, b]) {
      const p = s.world.get(e, Position);
      const n = nodeOfPosition(p.x, p.y);
      expect(p).toEqual(positionOfNode(n.hx, n.hy));
      expect(terrain.isWalkable(terrain.nodeAt(n.hx, n.hy))).toBe(true);
      expect(dynamicBlockOverlay(s.world, ctxOf(s), terrain).has(terrain.nodeAt(n.hx, n.hy))).toBe(false);
    }
  },
);

it.each(['gossip', 'wedding'] as const)(
  'cancels %s before adjacent partners with failed routes start atomics',
  (ritual) => {
    const map = grassNodeMap(16, 16);
    const typeIds = [...map.typeIds];
    typeIds[5 * 16 + 4] = 1;
    const sim = new Simulation({ seed: 1, content: testContent(), map: { ...map, typeIds } });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('terrain');
    const a = ownedWoodcutter(sim, 0, 0);
    sim.world.add(a, Position, positionOfNode(5, 6));
    setNeeds(sim, a, { enjoyment: fx.fromInt(1) });
    const b = ownedWoodcutter(sim, 0, 0);
    setSettlerJob(sim.world, b, 6);
    sim.world.add(b, Position, positionOfNode(4, 4));
    sim.world.add(b, MoveGoal, { cell: terrain.nodeAt(6, 8) });
    navigationPlanner(sim.world, terrain);
    pathfindingSystem(sim.world, ctxOf(sim));
    for (let i = 0; i < 30; i++) {
      movementSystem(sim.world, nextTickCtxOf(sim));
      const p = sim.world.get(b, Position);
      if (nodeOfPosition(p.x, p.y).hy === 5) break;
    }
    const before = { ...sim.world.get(b, Position) };
    expect(nodeOfPosition(before.x, before.y)).toEqual({ hx: 4, hy: 5 });
    expect(sim.world.has(b, PathFollow)).toBe(true);
    sim.world.add(b, MoveGoal, { cell: terrain.nodeAt(4, 5) });
    navigationPlanner(sim.world, terrain);
    pathfindingSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(b, PathRequest).failed).toBe(true);
    expect(sim.world.has(b, PathFollow)).toBe(true);
    if (ritual === 'gossip') {
      expect(
        planGossipSeek(
          sim.world,
          ctxOf(sim),
          a,
          sim.world.get(a, Settler),
          5,
          6,
          new GossipCandidates(sim.world, sim.content),
        ),
      ).toBe(true);
      gossipSystem(sim.world, ctxOf(sim));
    } else {
      startWedding(sim.world, a, b);
      driveWeddings(sim.world, ctxOf(sim), terrain);
    }
    expect(sim.world.has(b, PathFollow)).toBe(true);
    expect(sim.world.has(b, CurrentAtomic)).toBe(false);
    expect(sim.world.has(a, Chat)).toBe(false);
    expect(sim.world.has(a, Wedding)).toBe(false);
    expect(sim.world.has(b, Wedding)).toBe(false);
    for (let tick = 0; tick < 30 && sim.world.has(b, PathFollow); tick++)
      movementSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.has(b, PathFollow)).toBe(false);
    expect(sim.world.get(b, Position)).toEqual(positionOfNode(5, 6));
    expect(sim.checkInvariants()).toEqual([]);
  },
);
