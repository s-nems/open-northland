import type { FootprintCell } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  GroundDrop,
  MineDeposit,
  Position,
  Resource,
  Stockpile,
} from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { fx, positionOfNode, Simulation } from '../../../../src/index.js';
import { HEX_NEIGHBOUR_OFFSETS, nodeOfPosition } from '../../../../src/nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../src/nav/terrain/index.js';
import {
  positionedInteractionCell,
  resourceWorkCell,
  stampResourceFootprintData,
} from '../../../../src/systems/footprint/index.js';
import { harvestFromNode } from '../../../../src/systems/settlers/atomics/effects/goods/harvest.js';
import { collectTargets, nearestStoreHolding } from '../../../../src/systems/settlers/targets/index.js';
import { collectSupplyTally } from '../../../../src/systems/stores/index.js';
import { testContent } from '../../../fixtures/content.js';
import { ctxOf } from '../../../fixtures/context.js';
import { grassCellMap } from '../../../fixtures/terrain.js';

// A stance or pile cell no walk can enter must never be handed out: every pick of it path-fails, and
// the failed-goal memo only delays the next identical pick.

const STONE = 4; // fixture good with a harvest atomic
const HARVEST_STONE = 25;
const MINER = 5; // fixture job allowed the stone harvest atomic
const VIKING = 1;
const STROKE_COMPLETES_UNIT = 1;
const ANCHOR = { x: 10, y: 6 }; // an even row, so footprint offsets stamp literally
const CELL = { dx: 0, dy: 0 };
const EAST = { dx: 1, dy: 0 };
/** A cell and its six lattice neighbours: blocking the neighbours seals the cell. */
const CELL_AND_NEIGHBOURS = [CELL, ...HEX_NEIGHBOUR_OFFSETS];

const sameOffset = (a: FootprintCell, b: FootprintCell): boolean => a.dx === b.dx && a.dy === b.dy;
/** The east neighbour's ring, shifted along the row, so the even-row frame still holds. */
const EAST_RING = HEX_NEIGHBOUR_OFFSETS.map(({ dx, dy }) => ({ dx: dx + EAST.dx, dy: dy + EAST.dy }));

/** The cell and five of its lattice neighbours, plus the rest of the ring of the sixth, `EAST`: that
 *  neighbour stays open but sealed in a one-node pocket. */
const CELL_WITH_SEALED_EAST_NEIGHBOUR = [
  CELL,
  ...HEX_NEIGHBOUR_OFFSETS.filter((c) => !sameOffset(c, EAST)),
  ...EAST_RING.filter((c) => !sameOffset(c, CELL) && !HEX_NEIGHBOUR_OFFSETS.some((n) => sameOffset(n, c))),
];

function mappedSim(): { sim: Simulation; terrain: TerrainGraph } {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(12, 6) });
  if (sim.terrain === undefined) throw new Error('mapped sim expected');
  return { sim, terrain: sim.terrain };
}

/** A walk-blocking body anchored at half-cell NODE (x, y), like a stone covering those cells. */
function blockerAt(sim: Simulation, x: number, y: number, walk: readonly FootprintCell[]): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(x, y));
  // Fresh cells: a component never holds a shared constant's objects.
  stampResourceFootprintData(sim.world, e, {
    walk: walk.map(({ dx, dy }) => ({ dx, dy })),
    build: [],
    work: [],
  });
  return e;
}

function stoneDropAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(x, y));
  sim.world.add(e, Stockpile, { amounts: new Map([[STONE, 1]]) });
  sim.world.add(e, GroundDrop, { goodType: STONE });
  return e;
}

function nodeOf(sim: Simulation, terrain: TerrainGraph, e: Entity): NodeId {
  const p = sim.world.get(e, Position);
  const n = nodeOfPosition(p.x, p.y);
  return terrain.nodeAt(n.hx, n.hy);
}

describe('stances no walk can enter', () => {
  it('skips a work cell sealed in a pocket for the open one, for the node and a drop under it', () => {
    const { sim, terrain } = mappedSim();
    const ctx = ctxOf(sim);
    const node = sim.world.create();
    sim.world.add(node, Position, positionOfNode(ANCHOR.x, ANCHOR.y));
    sim.world.add(node, Resource, { goodType: STONE, remaining: 3, harvestAtomic: HARVEST_STONE });
    stampResourceFootprintData(sim.world, node, {
      walk: [{ dx: 0, dy: 0 }],
      build: [],
      work: [
        { dx: -2, dy: 0 },
        { dx: 2, dy: 0 },
      ],
    });
    const sealed = { x: ANCHOR.x - 2, y: ANCHOR.y };
    blockerAt(sim, sealed.x, sealed.y, HEX_NEIGHBOUR_OFFSETS);
    const drop = stoneDropAt(sim, ANCHOR.x, ANCHOR.y);
    const from = terrain.nodeAt(2, ANCHOR.y); // nearer the sealed stance
    const open = terrain.nodeAt(ANCHOR.x + 2, ANCHOR.y);

    expect(resourceWorkCell(sim.world, ctx, terrain, node, from)).toBe(open);
    expect(positionedInteractionCell(sim.world, ctx, terrain, drop, from)).toBe(open);
  });

  it('keeps a pile no unit can stand on or beside out of the fetch sources', () => {
    const { sim, terrain } = mappedSim();
    const ctx = ctxOf(sim);
    blockerAt(sim, ANCHOR.x, ANCHOR.y, CELL_AND_NEIGHBOURS);
    stoneDropAt(sim, ANCHOR.x, ANCHOR.y);
    const here = terrain.nodeAt(2, ANCHOR.y);

    const targets = collectTargets(sim.world, ctx, terrain);
    expect(
      nearestStoreHolding(
        targets.bands,
        sim.world,
        here,
        here,
        STONE,
        undefined,
        collectSupplyTally(sim.world),
      ),
    ).toBeNull();
  });

  it('never sends a fetcher to a pile whose only stance is sealed in a pocket', () => {
    const { sim, terrain } = mappedSim();
    const ctx = ctxOf(sim);
    blockerAt(sim, ANCHOR.x, ANCHOR.y, CELL_WITH_SEALED_EAST_NEIGHBOUR);
    stoneDropAt(sim, ANCHOR.x, ANCHOR.y);
    const here = terrain.nodeAt(2, ANCHOR.y);

    const targets = collectTargets(sim.world, ctx, terrain);
    expect(
      nearestStoreHolding(
        targets.bands,
        sim.world,
        here,
        here,
        STONE,
        undefined,
        collectSupplyTally(sim.world),
      ),
    ).toBeNull();
  });

  it.each([
    ['cover', CELL_AND_NEIGHBOURS],
    ['seal in a pocket', CELL_WITH_SEALED_EAST_NEIGHBOUR],
  ])("carries ore a worked-out deposit's neighbours %s to the miner's stance", (_shape, walk) => {
    const { sim, terrain } = mappedSim();
    const ctx = ctxOf(sim);
    const deposit = sim.world.create();
    sim.world.add(deposit, Position, positionOfNode(ANCHOR.x, ANCHOR.y));
    sim.world.add(deposit, Resource, { goodType: STONE, remaining: 1, harvestAtomic: HARVEST_STONE });
    sim.world.add(deposit, MineDeposit, { initial: 1, levels: 1, strikes: 0 });
    stampResourceFootprintData(sim.world, deposit, { walk: [], build: [], work: [{ dx: -2, dy: 0 }] });
    blockerAt(sim, ANCHOR.x, ANCHOR.y, walk);
    const stance = { x: ANCHOR.x - 2, y: ANCHOR.y };
    const miner = sim.world.create();
    sim.world.add(miner, Position, positionOfNode(stance.x, stance.y));
    addPerson(sim.world, miner, {
      tribe: VIKING,
      jobType: MINER,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
    });

    expect(harvestFromNode(sim.world, ctx, miner, deposit, STONE, STROKE_COMPLETES_UNIT)).toBe(1);

    expect(sim.world.isAlive(deposit)).toBe(false);
    const drops = [...sim.world.query(GroundDrop)];
    expect(drops).toHaveLength(1);
    const [ore] = drops;
    if (ore === undefined) throw new Error('ore drop expected');
    expect(nodeOf(sim, terrain, ore)).toBe(terrain.nodeAt(stance.x, stance.y));
    expect(sim.world.get(ore, Stockpile).amounts.get(STONE)).toBe(1);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
