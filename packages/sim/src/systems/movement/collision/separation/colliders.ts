import { Obstructed, PathFollow, PathRoute, Position } from '../../../../components/index.js';
import { type Fixed, ZERO } from '../../../../core/fixed.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import { worldX } from '../../../../nav/world-metric.js';
import type { SystemContext } from '../../../context.js';
import { writeLegHeading } from '../../stepping.js';
import { hasSoftCollision, isStanding } from '../bodies.js';
import { hasBodyCollision, ownedFighters } from '../owned-fighters.js';
import { worldYOf } from './geometry.js';
import type { ColliderColumns, MoverColumns, SeparationScratch } from './scratch.js';

/** The census buffer's first size; it doubles whenever the walkers outgrow it. */
const MIN_ORDER_CAPACITY = 256;

/**
 * Fill this tick's mover and post columns and their node grids. False when nobody is walking - the
 * dormancy exit, since nothing can overlap anything.
 */
export function collectColliders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  scratch: SeparationScratch,
): boolean {
  const { movers, posts } = scratch;
  scratch.census++;
  let moverCount = 0;
  for (const e of world.query(PathFollow, Position)) {
    if (!hasSoftCollision(world, e)) continue;
    if (moverCount === scratch.order.length) scratch.order = grown(scratch.order);
    scratch.order[moverCount++] = e;
  }
  // Before the dormancy exit: a grind ends on arrival, a re-route, or a profession change out of the
  // fighting trades, and none of those walk, so its holder is never a mover.
  for (const e of world.canonicalQuery(Obstructed)) {
    if (!world.has(e, PathFollow) || !hasBodyCollision(world, ctx.content, e)) world.remove(e, Obstructed);
  }
  movers.count = moverCount;
  if (moverCount === 0) return false;
  // A typed numeric sort runs in place; an array sort with a comparator copied the list every tick.
  const order = scratch.order.subarray(0, moverCount).sort();

  let firmCount = 0;
  for (let slot = 0; slot < moverCount; slot++) {
    const e = order[slot] as Entity;
    const p = world.get(e, Position);
    place(movers, slot, e, p.x, p.y);
    const firm = hasBodyCollision(world, ctx.content, e);
    movers.firm[slot] = firm;
    if (firm) firmCount++;
    // Both present by the movers query above.
    const target = world.get(e, PathRoute).waypoints[world.get(e, PathFollow).index];
    movers.hasTarget[slot] = target !== undefined;
    movers.targetX[slot] = target?.x ?? ZERO;
    movers.targetY[slot] = target?.y ?? ZERO;
  }
  movers.grid.fill(terrain, moverCount, movers.hx, movers.hy);

  // The immovable posts firm movers resolve against, ascending like the fighter index, gathered only when a
  // firm mover exists: soft-only traffic (a civilian economy tick) never reads the post grid.
  let postCount = 0;
  if (firmCount > 0) {
    for (const e of ownedFighters(world, ctx.content)) {
      const p = world.tryGet(e, Position);
      if (p !== undefined && isStanding(world, e)) place(posts, postCount++, e, p.x, p.y);
    }
  }
  posts.count = postCount;
  posts.grid.fill(terrain, postCount, posts.hx, posts.hy);
  return true;
}

function place(columns: ColliderColumns, slot: number, e: Entity, x: Fixed, y: Fixed): void {
  columns.entity[slot] = e;
  columns.x[slot] = x;
  columns.y[slot] = y;
  columns.worldX[slot] = worldX(x, y);
  columns.worldY[slot] = worldYOf(y);
  columns.hx[slot] = nodeHxOfPosition(x, y);
  columns.hy[slot] = nodeHyOfPosition(y);
}

/** Mover `slot`'s unit world heading toward its leg target, zero without one; derived once per census. */
export function moverHeading(scratch: SeparationScratch, slot: number): void {
  const movers: MoverColumns = scratch.movers;
  if (movers.headingCensus[slot] === scratch.census) return;
  movers.headingCensus[slot] = scratch.census;
  const out = scratch.heading;
  if (movers.hasTarget[slot] === true) {
    const from = scratch.headingFrom;
    const to = scratch.headingTo;
    from.x = movers.x[slot] ?? ZERO;
    from.y = movers.y[slot] ?? ZERO;
    to.x = movers.targetX[slot] ?? ZERO;
    to.y = movers.targetY[slot] ?? ZERO;
    writeLegHeading(from, to, out);
  } else {
    out.hx = ZERO;
    out.hy = ZERO;
  }
  movers.headingX[slot] = out.hx;
  movers.headingY[slot] = out.hy;
}

function grown(ids: Int32Array): Int32Array {
  const next = new Int32Array(Math.max(MIN_ORDER_CAPACITY, ids.length * 2));
  next.set(ids);
  return next;
}
