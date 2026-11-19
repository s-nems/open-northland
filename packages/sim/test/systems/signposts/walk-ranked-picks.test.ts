import type { Recipe } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  DeliveryFlag,
  JobAssignment,
  MoveGoal,
  Owner,
  Position,
  Stockpile,
  UnderConstruction,
  WorkFlag,
} from '../../../src/components/index.js';
import { ONE, ZERO } from '../../../src/core/fixed.js';
import type { Entity } from '../../../src/ecs/world.js';
import { cellAnchorNode, type NodeId, positionOfNode, Simulation } from '../../../src/index.js';
import { walkLengthTo } from '../../../src/nav/range-search.js';
import type { TerrainGraph } from '../../../src/nav/terrain/index.js';
import { navigationLimitFor, plannerSystem } from '../../../src/systems/index.js';
import { nearestMissingInputSource } from '../../../src/systems/settlers/drives/economy/workshop/supply.js';
import { claimWorkCell } from '../../../src/systems/settlers/drives/spacing.js';
import type { PlannerContext } from '../../../src/systems/settlers/planner/context.js';
import { PlannerSpacing } from '../../../src/systems/settlers/planner/spacing.js';
import { collectTargets, interactionCell } from '../../../src/systems/settlers/targets/index.js';
import { rankFromSpot, walkLengthsFrom } from '../../../src/systems/signposts/index.js';
import { GossipCandidates } from '../../../src/systems/social/index.js';
import { manhattan, nearestCell } from '../../../src/systems/spatial/metric.js';
import { NodeBuckets } from '../../../src/systems/spatial/nodes.js';
import { collectSupplyTally } from '../../../src/systems/stores/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { waterColumnMap } from '../../fixtures/terrain.js';
import { placeFellableTree } from '../settlers/drives/gatherer-flag/support.js';

/**
 * With signpost navigation on, a pick ranked from another node than the settler's own, a workshop door or
 * a flag, takes the shortest walk from that node, not the shortest line. A river runs down the map with a
 * ford at its foot: the target across it is the nearer by line and the farther by walk, and both lie
 * inside every reach, so only the ranking tells them apart.
 */

const VIKING = 1;
const P0 = 0;
const WOODCUTTER = 1;
const CARPENTER = 2;
const HEADQUARTERS = 1;
const SAWMILL = 2;
const WOOD = 1;
const CELLS_W = 40;
const CELLS_H = 12;
const RIVER_COLUMN = 20;
const FORD_ROWS = 2;
/** The origin the picks rank from, three cells off the river's east bank. */
const ORIGIN_CELL = { x: 23, y: 5 };
/** Six cells west of the origin by line, round the ford by walk. */
const ACROSS_CELL = { x: 17, y: 5 };
/** Ten cells east of the origin on its own bank. */
const UP_THE_BANK_CELL = { x: 33, y: 5 };
/** Where the settler stands, off the origin, so its own walk is not the one the pick ranks by. */
const SETTLER_CELL = { x: 26, y: 8 };
/** A flag radius in nodes holding both trees. */
const FLAG_RADIUS = 30;
const WOOD_UNITS = 5;

function riverSim(confined: boolean): { sim: Simulation; terrain: TerrainGraph } {
  const sim = new Simulation({
    seed: 5,
    content: testContent(),
    map: waterColumnMap(CELLS_W, CELLS_H, RIVER_COLUMN, FORD_ROWS),
  });
  sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: confined });
  sim.step();
  if (sim.terrain === undefined) throw new Error('mapped sim');
  return { sim, terrain: sim.terrain };
}

function nodeOfCell(terrain: TerrainGraph, cell: { x: number; y: number }): NodeId {
  const anchor = cellAnchorNode(cell.x, cell.y);
  return terrain.nodeAt(anchor.hx, anchor.hy);
}

function settlerOn(sim: Simulation, cell: { x: number; y: number }, jobType: number): Entity {
  const e = sim.world.create();
  const anchor = cellAnchorNode(cell.x, cell.y);
  sim.world.add(e, Position, positionOfNode(anchor.hx, anchor.hy));
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType,
    hunger: ZERO,
    fatigue: ZERO,
    piety: ZERO,
    enjoyment: ZERO,
  });
  sim.world.add(e, Owner, { player: P0 });
  return e;
}

function buildingOn(
  sim: Simulation,
  cell: { x: number; y: number },
  buildingType: number,
  goods: [number, number][] = [],
): Entity {
  const e = sim.world.create();
  const anchor = cellAnchorNode(cell.x, cell.y);
  sim.world.add(e, Position, positionOfNode(anchor.hx, anchor.hy));
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map(goods) });
  sim.world.add(e, Owner, { player: P0 });
  return e;
}

function planOf(
  sim: Simulation,
  terrain: TerrainGraph,
  e: Entity,
  jobType: number,
  here: NodeId,
): PlannerContext {
  const ctx = ctxOf(sim);
  return {
    world: sim.world,
    ctx,
    terrain,
    entity: e,
    here,
    tribe: VIKING,
    jobType,
    experience: new Map(),
    owner: P0,
    limit: navigationLimitFor(sim.world, sim.content, terrain, e),
    targets: collectTargets(sim.world, ctx, terrain),
    supply: collectSupplyTally(sim.world),
    gossipCandidates: new GossipCandidates(sim.world, sim.content),
  };
}

describe("a workshop's input fetch across a river", () => {
  const RECIPE: Recipe = { inputs: [{ goodType: WOOD, amount: 1 }], outputs: [], ticks: 1 };

  function scene(confined: boolean) {
    const { sim, terrain } = riverSim(confined);
    const mill = buildingOn(sim, ORIGIN_CELL, SAWMILL);
    const across = buildingOn(sim, ACROSS_CELL, HEADQUARTERS, [[WOOD, WOOD_UNITS]]);
    const upTheBank = buildingOn(sim, UP_THE_BANK_CELL, HEADQUARTERS, [[WOOD, WOOD_UNITS]]);
    const carpenter = settlerOn(sim, SETTLER_CELL, CARPENTER);
    sim.world.add(carpenter, JobAssignment, { workplace: mill });
    const plan = planOf(sim, terrain, carpenter, CARPENTER, nodeOfCell(terrain, SETTLER_CELL));
    return { sim, terrain, plan, mill, across, upTheBank };
  }

  it("takes the store up the workshop's own bank, a longer line and a shorter walk from its door", () => {
    const { sim, terrain, plan, mill, across, upTheBank } = scene(true);
    const door = interactionCell(sim.world, plan.ctx, terrain, mill, plan.here);
    const doorOf = (store: Entity): NodeId => interactionCell(sim.world, plan.ctx, terrain, store, plan.here);
    expect(manhattan(terrain, door, doorOf(across))).toBeLessThan(
      manhattan(terrain, door, doorOf(upTheBank)),
    );
    expect(plan.limit?.allowsNode(doorOf(across))).toBe(true);

    const source = nearestMissingInputSource(plan, mill, RECIPE, { restockToCapacity: false });
    expect(source?.store).toBe(upTheBank);
    // Nothing confines the same worker: no walk is measured, and the line decides.
    const free = nearestMissingInputSource({ ...plan, limit: null }, mill, RECIPE, {
      restockToCapacity: false,
    });
    expect(free?.store).toBe(across);
  });
});

describe("a flag gatherer's tree across a river", () => {
  /** The bank of the tree the woodcutter sets out for after one planner pass. */
  function bankWalkedTo(confined: boolean): 'east' | 'west' | null {
    const { sim, terrain } = riverSim(confined);
    const cutter = settlerOn(sim, SETTLER_CELL, WOODCUTTER);
    const flag = sim.world.create();
    const at = cellAnchorNode(ORIGIN_CELL.x, ORIGIN_CELL.y);
    sim.world.add(flag, Position, positionOfNode(at.hx, at.hy));
    sim.world.add(flag, DeliveryFlag, {});
    sim.world.add(cutter, WorkFlag, { flag, radius: FLAG_RADIUS });
    for (const cell of [ACROSS_CELL, UP_THE_BANK_CELL]) {
      const tree = placeFellableTree(sim, 0, 0);
      const anchor = cellAnchorNode(cell.x, cell.y);
      const p = sim.world.mut(tree, Position);
      ({ x: p.x, y: p.y } = positionOfNode(anchor.hx, anchor.hy));
    }
    plannerSystem(sim.world, ctxOf(sim));
    const goal = sim.world.tryGet(cutter, MoveGoal)?.cell;
    if (goal === undefined) return null;
    return terrain.xOf(goal) > terrain.xOf(nodeOfCell(terrain, { x: RIVER_COLUMN, y: ORIGIN_CELL.y }))
      ? 'east'
      : 'west';
  }

  it("fells the tree up the flag's own bank, which the line from the flag ranks second", () => {
    expect(bankWalkedTo(true)).toBe('east');
    expect(bankWalkedTo(false)).toBe('west');
  });
});

describe("a builder's stand at a site behind a river", () => {
  /** The site stands two cells past the river on the settler's row, three cell rows above the ford. */
  const SITE_CELL = { x: 22, y: 6 };
  const BUILDER_CELL = { x: 16, y: 6 };

  it('claims the perimeter cell with the shortest walk, not the one facing the builder across the water', () => {
    const { sim, terrain } = riverSim(true);
    const site = sim.world.create();
    const anchor = cellAnchorNode(SITE_CELL.x, SITE_CELL.y);
    sim.world.add(site, Position, positionOfNode(anchor.hx, anchor.hy));
    sim.world.add(site, Building, { buildingType: SAWMILL, tribe: VIKING, built: ZERO, level: 0 });
    sim.world.add(site, UnderConstruction, { labor: ZERO });
    const builder = settlerOn(sim, BUILDER_CELL, WOODCUTTER);
    const here = nodeOfCell(terrain, BUILDER_CELL);
    const spacing = (): PlannerSpacing =>
      PlannerSpacing.overExplicit(
        sim.world,
        ctxOf(sim),
        terrain,
        new NodeBuckets(sim.world, [builder]),
        new Set(),
      );
    const cells = spacing().workCells(site);
    const from = terrain.coordsOf(here);
    const lengths = walkLengthsFrom(sim.world, sim.content, terrain, from.x, from.y, CELLS_W * 2);
    if (lengths === null) throw new Error('a walk starts on the bank');
    const stepsTo = (cell: NodeId): number => walkLengthTo(lengths, terrain.xOf(cell), terrain.yOf(cell));
    const byWalk = [...cells].sort((a, b) => stepsTo(a) - stepsTo(b) || a - b)[0];
    const byLine = nearestCell(terrain, cells, here);
    expect(byWalk).not.toBe(byLine);

    const limit = navigationLimitFor(sim.world, sim.content, terrain, builder);
    const rank = rankFromSpot(limit, here);
    expect(claimWorkCell(sim.world, terrain, builder, here, site, spacing(), rank)).toBe(byWalk);
    expect(claimWorkCell(sim.world, terrain, builder, here, site, spacing(), here)).toBe(byLine);
  });
});
