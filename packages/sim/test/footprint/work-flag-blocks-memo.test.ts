import { describe, expect, it } from 'vitest';
import {
  Building,
  Owner,
  Position,
  Resource,
  ResourceFootprint,
  Settler,
  WorkFlag,
} from '../../src/components/index.js';
import type { Command } from '../../src/core/commands/index.js';
import { fx } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { positionOfNode, type Simulation } from '../../src/index.js';
import type { BlockOverlay } from '../../src/nav/block-overlay.js';
import type { NodeId } from '../../src/nav/terrain/index.js';
import {
  type BlockerChannel,
  type BlockerVisit,
  BUILDING_ZONE,
  buildingBlockerCells,
  EXCLUSION,
  OBSTACLE,
  RESOURCE_ANCHOR,
  resourceBlockerCells,
} from '../../src/systems/footprint/placement/blockers.js';
import { setWorkFlag, workFlagPlacementBlocks } from '../../src/systems/index.js';
import { ctxOf } from '../fixtures/context.js';
import { HUT, mappedSim, terrainOf, VIKING } from './building-placement/support.js';

/**
 * The work-flag blocked set feeds command gates and the auto-flag plant, so the incremental state
 * must see every input change: a flag ADD, REMOVE and — the one `componentGeneration` alone cannot
 * see — an in-place MOVE must each land in the set. The state is ONE live set per world (identity
 * stable across changes, contents caught up on read); the `verifyCaches` verifier proves it equal
 * to a full re-derive under the fuzz/invariant runs.
 */

const WOODCUTTER = 1;
const P0 = 0;
const WOOD = 1;
const HARVEST_ATOMIC = 24;

function ownedGatherer(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: WOODCUTTER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Owner, { player: P0 });
  return e;
}

const flagCmd = (entity: Entity, x: number, y: number): Extract<Command, { kind: 'setWorkFlag' }> => ({
  kind: 'setWorkFlag',
  entity,
  x,
  y,
});

function blocksOf(sim: Simulation): BlockOverlay {
  return workFlagPlacementBlocks(sim.world, sim.content, terrainOf(sim));
}

describe('workFlagPlacementBlocks incremental state', () => {
  it('tracks a flag add/MOVE/remove in the one shared live set', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const g = ownedGatherer(sim, 12, 12);
    const A = { x: 4, y: 4 };
    const B = { x: 20, y: 8 };

    const idle = blocksOf(sim);
    for (let t = 0; t < 3; t++) sim.step();
    expect(blocksOf(sim)).toBe(idle); // the state is one live set per world — identity holds

    setWorkFlag(sim.world, ctxOf(sim), flagCmd(g, A.x, A.y)); // ADD (a fresh flag entity)
    const added = blocksOf(sim);
    expect(added.has(terrain.nodeAt(A.x, A.y))).toBe(true);

    setWorkFlag(sim.world, ctxOf(sim), flagCmd(g, B.x, B.y)); // MOVE (in-place Position write)
    const moved = blocksOf(sim);
    expect(moved.has(terrain.nodeAt(B.x, B.y))).toBe(true);
    expect(moved.has(terrain.nodeAt(A.x, A.y))).toBe(false);

    sim.world.destroy(sim.world.get(g, WorkFlag).flag); // REMOVE
    const removed = blocksOf(sim);
    expect(removed.has(terrain.nodeAt(B.x, B.y))).toBe(false);
  });

  it('blocks a blocker body but leaves its margin zones open for a flag', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);

    const tree = sim.world.create();
    sim.world.add(tree, Position, positionOfNode(10, 10));
    sim.world.add(tree, Resource, { goodType: WOOD, remaining: 3, harvestAtomic: HARVEST_ATOMIC });
    sim.world.add(tree, ResourceFootprint, {
      walk: [{ dx: 0, dy: 2 }],
      build: [{ dx: 0, dy: 4 }],
      work: [],
    });

    const hut = sim.world.create();
    sim.world.add(hut, Position, positionOfNode(4, 4));
    sim.world.add(hut, Building, { buildingType: HUT, tribe: VIKING, built: fx.fromInt(1), level: 0 });

    // Read the channels the blocker layer actually emits, so this pins the channel RULE rather than
    // re-deriving footprint parity. Both paths the cache verifier compares apply that rule, so a flip
    // in it is invisible to the verifier and only shows up here.
    const emitted = new Map<string, Map<BlockerChannel, NodeId[]>>();
    for (const [what, emit] of [
      ['resource', (v: BlockerVisit) => resourceBlockerCells(sim.world, tree, v)],
      ['building', (v: BlockerVisit) => buildingBlockerCells(sim.world, sim.content, hut, v)],
    ] as const) {
      const byChannel = new Map<BlockerChannel, NodeId[]>();
      emit((x, y, channel) => {
        if (!terrain.inBounds(x, y)) return;
        byChannel.set(channel, [...(byChannel.get(channel) ?? []), terrain.nodeAt(x, y)]);
      });
      emitted.set(what, byChannel);
    }
    const bodyOf = (c: Map<BlockerChannel, NodeId[]>): NodeId[] => [
      ...(c.get(RESOURCE_ANCHOR) ?? []),
      ...(c.get(OBSTACLE) ?? []),
    ];
    // Every body cell of EITHER fixture, so a later fixture edit that overlaps them fails on the
    // vacuity guard rather than as a confusing "margin node blocked".
    const allBodies = [...emitted.values()].flatMap(bodyOf);

    const blocks = blocksOf(sim);
    for (const [what, byChannel] of emitted) {
      const body = bodyOf(byChannel);
      const zones = [...(byChannel.get(EXCLUSION) ?? []), ...(byChannel.get(BUILDING_ZONE) ?? [])];
      const margin = zones.filter((n) => !allBodies.includes(n));
      expect(body.length, `${what} body`).toBeGreaterThan(0); // a vacuous fixture passes everything below
      expect(margin.length, `${what} margin`).toBeGreaterThan(0);
      for (const node of body) expect(blocks.has(node), `${what} body node ${node}`).toBe(true);
      for (const node of margin) expect(blocks.has(node), `${what} margin node ${node}`).toBe(false);
    }
  });

  it('keeps the ignoreFlag variant separate from the shared live set', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const g = ownedGatherer(sim, 12, 12);
    setWorkFlag(sim.world, ctxOf(sim), flagCmd(g, 4, 4));
    const flag = sim.world.get(g, WorkFlag).flag;

    const withFlag = blocksOf(sim);
    const ignoring = workFlagPlacementBlocks(sim.world, sim.content, terrainOf(sim), flag);
    expect(withFlag.has(terrain.nodeAt(4, 4))).toBe(true);
    expect(ignoring.has(terrain.nodeAt(4, 4))).toBe(false); // its own cell must not block a re-place
    expect(blocksOf(sim).has(terrain.nodeAt(4, 4))).toBe(true); // the ignore path never mutated the shared set
  });

  it('keeps a node the ignored flag shares with another blocker blocked', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const g = ownedGatherer(sim, 12, 12);
    const SPOT = { x: 4, y: 4 };
    setWorkFlag(sim.world, ctxOf(sim), flagCmd(g, SPOT.x, SPOT.y));
    const flag = sim.world.get(g, WorkFlag).flag;

    // A resource standing on the flag's own cell: two contributions to that node, so withholding the
    // flag's own leaves the resource's, and the node stays illegal ground for a re-place.
    const tree = sim.world.create();
    sim.world.add(tree, Position, positionOfNode(SPOT.x, SPOT.y));
    sim.world.add(tree, Resource, { goodType: WOOD, remaining: 3, harvestAtomic: HARVEST_ATOMIC });

    const ignoring = workFlagPlacementBlocks(sim.world, sim.content, terrain, flag);
    expect(ignoring.has(terrain.nodeAt(SPOT.x, SPOT.y))).toBe(true);
  });
});
