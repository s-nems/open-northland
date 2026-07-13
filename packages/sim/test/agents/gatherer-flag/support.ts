import { grassNodeMap as grassMap } from '../../fixtures/terrain.js';

export { grassMap };

import { ctxOf } from '../../fixtures/context.js';

export { ctxOf };

import { beforeEach } from 'vitest';
import {
  CurrentAtomic,
  DeliveryFlag,
  Felling,
  GroundDrop,
  HarvestedBy,
  Position,
  Resource,
  Settler,
  Stockpile,
  WorkFlag,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
  CORE_INVARIANTS,
  checkInvariants,
  fx,
  type Simulation,
  type TerrainMap,
} from '../../../src/index.js';
import { atomicSystem, isYardHeap } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { clearComponentStores } from '../../fixtures/stores.js';

/**
 * THE FLAG-BOUND GATHERER (user-specified behaviour): each gatherer is bound to its own flag ({@link
 * WorkFlag}) and, unlike an unbound roaming collector, it
 *
 *  1. carries every good it harvests to THAT flag (not merely the nearest store),
 *  2. carries off ONLY the trunks/ore it dug itself ({@link HarvestedBy}) — a loose pile it did not make is
 *     left in peace,
 *  3. looks for work ONLY within its flag's radius, standing idle beside the flag when nothing is in reach.
 *
 * A gatherer WITHOUT a WorkFlag keeps the prior roam-and-haul behaviour (proven in felling.test.ts); the
 * ownership mark is stamped only for flag-bound harvesters, so that older behaviour — and every golden — is
 * byte-identical. Distances are on the half-cell lattice: a bare fixture at tile f sits at node 2f (row 0),
 * an unfootprinted node's work cell is its own anchor node, so flag→node distance is exactly 2·|f−t|.
 */

export const GRASS = 0;
export const WATER = 1; // landscape typeId flagged walkable:false in testContent — an impassable river cell
export const WOOD = 1;
export const WOODCUTTER = 1; // fixture job allowed the wood harvest atomic (24)
export const VIKING = 1;
export const HARVEST_ATOMIC = 24;
export const WIDE_RADIUS = 40; // covers any node in these small strips
export const NARROW_RADIUS = 4; // tight enough that a distant node falls outside it

export const WOOD_GATHERING = testContent().goods.find((g) => g.id === 'wood')?.gathering;
export const CHOPS_TO_FELL = WOOD_GATHERING?.chopsToFell ?? 0;
export const TREE_WOOD_YIELD = WOOD_GATHERING?.yieldPerNode ?? 0;

beforeEach(clearComponentStores);

/** A grass half-cell map split by a vertical WATER wall on node columns `riverCols` (all rows) — a
 *  river with no crossing, so the nodes left and right of it are separate static components (the
 *  "mosty na rzece" precondition: bridges are not walkable, so the two banks never connect). */
export function riverMap(width: number, height: number, riverCols: readonly number[]): TerrainMap {
  const typeIds = new Array(width * height).fill(GRASS);
  for (let hy = 0; hy < height; hy++) {
    for (const hx of riverCols) typeIds[hy * width + hx] = WATER;
  }
  return { resolution: 'half-cell', width, height, typeIds };
}

/** A woodcutter settler at tile (x,y). Add a {@link WorkFlag} to make it flag-bound. */
export function makeWoodcutter(sim: Simulation, x: number, y: number): Entity {
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
  return e;
}

/** Bind `gatherer` to a fresh flag — a pure {@link DeliveryFlag} marker (NO Stockpile; the harvest piles on
 *  the ground around it) at tile (fx,fy). Returns the flag entity. */
export function bindToFlag(
  sim: Simulation,
  gatherer: Entity,
  fxTile: number,
  fyTile: number,
  radius: number,
): Entity {
  const flag = sim.world.create();
  sim.world.add(flag, Position, { x: fx.fromInt(fxTile), y: fx.fromInt(fyTile) });
  sim.world.add(flag, DeliveryFlag, {});
  sim.world.add(gatherer, WorkFlag, { flag, radius });
  return flag;
}

/** The loose ground HEAPS a flag-bound gatherer stacks its harvest onto (the goods yard around the flag) —
 *  the shared {@link isYardHeap} predicate, the same one the sim + scene checks use. */
export function groundHeaps(sim: Simulation): Entity[] {
  return [...sim.world.query(Stockpile)].filter((e) => isYardHeap(sim.world, e));
}

/** Total WOOD across the goods-yard heaps (see {@link groundHeaps}). */
export function groundHeapWood(sim: Simulation): number {
  return groundHeaps(sim).reduce((sum, e) => sum + (sim.world.get(e, Stockpile).amounts.get(WOOD) ?? 0), 0);
}

/** A bare uncapped store (a warehouse) at tile (x,y). */
export function makeStore(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Stockpile, { amounts: new Map<number, number>() });
  return e;
}

/** A standing FELLABLE wood node at (x,y). */
export function placeFellableTree(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, { goodType: WOOD, remaining: TREE_WOOD_YIELD, harvestAtomic: HARVEST_ATOMIC });
  sim.world.add(e, Felling, { chopsLeft: CHOPS_TO_FELL });
  return e;
}

/** A LOOSE trunk pile lying on the ground with no owner — the "jakis lezy" heap a gatherer must ignore. */
export function makeLooseTrunk(sim: Simulation, x: number, y: number, amount: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Stockpile, { amounts: new Map([[WOOD, amount]]) });
  sim.world.add(e, GroundDrop, { goodType: WOOD });
  return e;
}

export function storeWood(sim: Simulation, store: Entity): number {
  return sim.world.get(store, Stockpile).amounts.get(WOOD) ?? 0;
}

export function trunkPile(sim: Simulation): Entity | undefined {
  return [...sim.world.query(GroundDrop)][0];
}

export function runTicks(sim: Simulation, ticks: number): string[] {
  const violations: string[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    if (violations.length === 0) {
      const v = checkInvariants(sim.world, CORE_INVARIANTS);
      if (v.length > 0) violations.push(`tick ${sim.tick}: ${v.join('; ')}`);
    }
  }
  return violations;
}

/** Start (and immediately complete, duration 1) a single chop of `node` by `settler` — isolated to the
 *  AtomicSystem so the planner never re-tasks the settler between chops. */
export function chopFully(sim: Simulation, settler: Entity, node: Entity): void {
  sim.world.add(settler, CurrentAtomic, {
    atomicId: HARVEST_ATOMIC,
    elapsed: 0,
    progress: fx.fromInt(0),
    duration: 1,
    effect: { kind: 'harvest', resource: node, goodType: WOOD },
    targetEntity: node,
    targetTile: null,
  });
  atomicSystem(sim.world, ctxOf(sim));
}
