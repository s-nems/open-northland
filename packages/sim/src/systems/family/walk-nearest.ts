import { Position } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { WalkLengths } from '../../nav/node-circle.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { interactionCellOf } from '../footprint/interaction.js';
import { interactionCell } from '../settlers/targets/index.js';
import { hexNodeDistance, manhattan } from '../spatial/metric.js';
import { leastRankLength, rankLength } from '../spatial/walk-rank.js';

/** A source with the length it ranks at. */
export interface RankedSource {
  readonly store: Entity;
  readonly length: number;
}

/** A source to haul from, with the good lifted there. */
export interface HaulSource extends RankedSource {
  readonly goodType: number;
}

/**
 * The source of the ascending-id `candidates` with the shortest `walk` to the cell it is lifted at, among
 * those `accept` passes: the lower id wins a tie, and a source the walk does not reach ranks after every
 * one it does, by distance. `seed` is a candidate `accept` passed, the nearest by distance, whose walk
 * bounds every walk asked after it. `accept` is a pure read, asked only of a source that may come nearer
 * than the best so far.
 */
export function nearestSourceByWalk(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  walk: WalkLengths,
  candidates: readonly Entity[],
  seed: Entity,
  accept: (e: Entity) => boolean,
): RankedSource {
  const here = walk.from;
  const hx = terrain.xOf(here);
  const hy = terrain.yOf(here);
  // A pile is lifted within the largest work-cell offset of its own node, a building at its door.
  const slack = contentIndex(ctx.content).maxResourceWorkOffset;
  const lengthOf = (e: Entity, within: number): number => {
    const cell = interactionCell(world, ctx, terrain, e, here);
    return rankLength(walk, cell, manhattan(terrain, here, cell), within);
  };
  let best = seed;
  let bestLength = lengthOf(seed, Number.POSITIVE_INFINITY);
  for (const e of candidates) {
    if (e === seed) continue;
    // A pile a placement earlier in this pass displaced is gone from the world but not from the list.
    const p = world.tryGet(e, Position);
    if (p === undefined) continue;
    const door = interactionCellOf(world, ctx, terrain, e);
    const span = Math.abs(nodeHxOfPosition(p.x, p.y) - hx) + Math.abs(nodeHyOfPosition(p.x, p.y) - hy);
    const least = door === null ? leastRankLength(walk, span - slack) : hexNodeDistance(terrain, here, door);
    if (least > bestLength || (least === bestLength && e > best)) continue;
    if (!accept(e)) continue;
    const length = lengthOf(e, bestLength);
    if (length > bestLength || (length === bestLength && e > best)) continue;
    best = e;
    bestLength = length;
  }
  return { store: best, length: bestLength };
}

/** The Manhattan distance from `from` to `store`'s own node: the length a source ranks at without a walk. */
export function sourceDistance(world: World, from: { hx: number; hy: number }, store: Entity): number {
  const p = world.get(store, Position);
  return Math.abs(nodeHxOfPosition(p.x, p.y) - from.hx) + Math.abs(nodeHyOfPosition(p.x, p.y) - from.hy);
}
