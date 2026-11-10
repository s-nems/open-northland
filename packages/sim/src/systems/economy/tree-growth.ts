import type { ContentSet } from '@open-northland/data';
import { Position, Resource, ResourceFootprint, TreeGrowth } from '../../components/index.js';
import type { LandscapeGrowth } from '../../core/content-index/landscape-growth.js';
import { contentIndex } from '../../core/content-index.js';
import { eventAt } from '../../core/events.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/blocked.js';
import { translatedCells } from '../footprint/geometry.js';
import {
  footprintCellsOf,
  stampResourceFootprintData,
  unstampResourceFootprint,
} from '../footprint/index.js';
import { dueForGrowth, LANDSCAPE_GROWTH_PERIOD_TICKS } from '../landscape/growth-clock.js';
import { anyRouteFollowed, invalidateRoutesThrough } from '../landscape/routes.js';
import { evictSettlersFromCells } from '../movement/evict.js';
import { growingTreesNearNode } from '../spatial/growing-trees.js';
import { resourcesNearNode } from '../spatial/resources.js';
import { evictLooseGoodsFromCells } from './goods-evict.js';
import { decorInReservedZone } from './reserved-decor.js';
import { evictWorkFlagsFromCells } from './work-flag.js';

/** Original behavior: a woodcutter fells, and a siege stone topples, only a tree above valency 2. */
export const FELLABLE_TREE_LEVEL = 3;

/** Ticks between two growth steps of one tree: one landscape growth period. */
export const TREE_GROWTH_PERIOD_TICKS = LANDSCAPE_GROWTH_PERIOD_TICKS;

/**
 * The wood a tree of valency `level` out of `levels` holds, `wood` being its full-grown yield. Original
 * behavior: the trunk keeps the tree's valency, so a tree too young to fell holds none.
 */
function treeWood(level: number, levels: number, wood: number): number {
  return level >= FELLABLE_TREE_LEVEL ? Math.floor((wood * level) / levels) : 0;
}

/** The growth of the tree record `resource` stands as, or undefined when the record does not grow. */
function growthOf(world: World, content: ContentSet, resource: Entity): LandscapeGrowth | undefined {
  const footprint = world.tryGet(resource, ResourceFootprint);
  if (footprint === undefined || !('gfx' in footprint)) return undefined;
  return contentIndex(content).landscapeGrowthByGfx.get(footprint.gfx);
}

/**
 * Set a freshly placed tree, holding its full-grown yield, at valency `level`: it holds the wood of that
 * valency, none while too young to fell, and grows on while below its record's full growth. A record
 * whose type does not grow keeps its yield.
 */
export function startTreeGrowth(world: World, content: ContentSet, tree: Entity, level: number): void {
  const growth = growthOf(world, content, tree);
  if (growth === undefined) return;
  const wood = world.get(tree, Resource).remaining;
  const at = Math.min(level, growth.maxLevel);
  world.mut(tree, Resource).remaining = treeWood(at, growth.maxLevel, wood);
  if (at < growth.maxLevel) world.add(tree, TreeGrowth, { level: at, levels: growth.maxLevel, wood });
}

/**
 * Grow every {@link TreeGrowth} tree in this run's map section by one growth step. The trees still growing
 * are the work, never the map's standing forest.
 */
export const treeGrowthSystem: System = (world, ctx) => {
  for (const tree of dueForGrowth(world, ctx, growingTreesNearNode)) growTree(world, ctx, tree);
};

/**
 * One growth step: the next valency, its block rows and its wood. A walk body the step closes moves the
 * settlers off it, as a building's does. Approximation: the original refuses a step whose walk body would
 * land on build-blocked ground; here a tree always grows.
 */
function growTree(world: World, ctx: SystemContext, tree: Entity): void {
  const growth = growthOf(world, ctx.content, tree);
  const footprint = world.get(tree, ResourceFootprint);
  if (growth === undefined || !('gfx' in footprint)) {
    world.remove(tree, TreeGrowth);
    return;
  }
  const { level: from, levels, wood } = world.get(tree, TreeGrowth);
  const level = Math.min(levels, from + growth.step);
  const pos = world.get(tree, Position);
  const before = walkNodes(world, ctx, tree);
  stampResourceFootprintData(world, tree, { ...footprint, level });
  if (level >= levels) world.remove(tree, TreeGrowth);
  else world.mut(tree, TreeGrowth).level = level;
  world.mut(tree, Resource).remaining = treeWood(level, levels, wood);
  settleClosedTree(world, ctx, tree, before);
  ctx.events.emit({ kind: 'treeGrew', node: tree, at: eventAt(pos.x, pos.y) });
}

/**
 * Settle the walk cells `tree` closes beyond `before`, the cells it already held, as a finished wall's
 * body is settled: the walkers whose routes cross them search again, and the settlers, loose goods and
 * work flags on them move off.
 */
export function settleClosedTree(
  world: World,
  ctx: SystemContext,
  tree: Entity,
  before: readonly NodeId[] = [],
): void {
  const terrain = ctx.terrain;
  const held = new Set(before);
  const closed = new Set(walkNodes(world, ctx, tree).filter((node) => !held.has(node)));
  if (terrain === undefined || closed.size === 0) return;
  if (anyRouteFollowed(world)) invalidateRoutesThrough(world, terrain, closed);
  evictSettlersFromCells(world, ctx, terrain, closed, 'move');
  evictLooseGoodsFromCells(world, ctx, terrain, closed);
  let blocked: BlockOverlay | null = null;
  evictWorkFlagsFromCells(world, ctx, terrain, closed, (node) => {
    blocked ??= dynamicBlockOverlay(world, ctx, terrain);
    return !blocked.has(node);
  });
}

/** The nodes `tree`'s footprint closes to walkers. */
function walkNodes(world: World, ctx: SystemContext, tree: Entity): NodeId[] {
  if (ctx.terrain === undefined) return [];
  const pos = world.get(tree, Position);
  const at = nodeOfPosition(pos.x, pos.y);
  return translatedCells(ctx.terrain, footprintCellsOf(world, tree).walk, at.hx, at.hy);
}

/**
 * Clear every growing tree inside `building`'s reserved zone: one too young to block placement may lie
 * under the plot and would otherwise grow up through the walls. Original behavior: a house clears every
 * landscape object under its body when placed and when an upgrade finishes; the whole reserved zone
 * follows the stump and bush rule.
 */
export function destroySaplingsInReserved(world: World, ctx: SystemContext, building: Entity): void {
  for (const tree of decorInReservedZone(world, ctx, building, resourcesNearNode)) {
    if (!world.has(tree, TreeGrowth)) continue;
    const pos = world.get(tree, Position);
    const goodType = world.get(tree, Resource).goodType;
    // Emitted for the static layer, which still draws a map-authored sapling.
    ctx.events.emit({ kind: 'resourceDepleted', node: tree, goodType, at: eventAt(pos.x, pos.y) });
    unstampResourceFootprint(world, tree);
    world.destroy(tree);
  }
}
