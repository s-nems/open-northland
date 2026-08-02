import { Obstructed, PathFollow, Position, Settler } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { canonicalById, NodeBuckets } from '../../../spatial/nodes.js';
import { hasBodyCollision, hasSoftCollision, isStanding } from '../bodies.js';
import type { MoverSnapshot, SeparationScratch } from './scratch.js';

type CensusScratch = Pick<SeparationScratch, 'movers' | 'posts' | 'firmMovers' | 'before' | 'snapshotPool'>;

export interface TickColliders {
  readonly movers: readonly Entity[];
  readonly firmMovers: ReadonlySet<Entity>;
  /**
   * Pre-separation positions AND headings, so a pair's two halves read the same state whatever the
   * processing order. Headings must come from here, not a live component read: the grind bookkeeping can
   * drop an earlier-processed mover's PathFollow mid-loop (a re-route/stand-down in a converging crowd),
   * so a live read on a later mover's neighbour would throw - and would split the pair order-dependently.
   */
  readonly before: ReadonlyMap<Entity, Readonly<MoverSnapshot>>;
  readonly moverIndex: NodeBuckets;
  readonly postIndex: NodeBuckets;
}

/** Null when nobody is walking - the dormancy exit, since nothing can overlap anything. */
export function collectColliders(
  world: World,
  ctx: SystemContext,
  scratch: CensusScratch,
): TickColliders | null {
  const { movers, firmMovers } = scratch;
  for (const e of world.query(PathFollow, Position)) {
    if (!hasSoftCollision(world, e)) continue;
    movers.push(e);
    if (hasBodyCollision(world, ctx.content, e)) firmMovers.add(e);
  }
  // Before the dormancy exit: a grind ends on arrival, a re-route, or a profession change out of the
  // fighting trades, and none of those walk, so its holder is never in `movers`.
  for (const e of canonicalById(world.query(Obstructed))) {
    if (!world.has(e, PathFollow) || !hasBodyCollision(world, ctx.content, e)) world.remove(e, Obstructed);
  }
  if (movers.length === 0) return null;
  movers.sort((a, b) => a - b);

  // The immovable posts firm movers resolve against, scanned only when a firm mover exists: soft-only
  // traffic (a civilian economy tick) never reads the index, so it skips the full-settler scan entirely.
  const { posts } = scratch;
  if (firmMovers.size > 0) {
    for (const e of world.query(Settler, Position)) {
      if (hasBodyCollision(world, ctx.content, e) && isStanding(world, e)) posts.push(e);
    }
  }
  const postIndex = new NodeBuckets(world, canonicalById(posts));
  const moverIndex = new NodeBuckets(world, movers);

  const { before, snapshotPool } = scratch;
  for (const e of movers) {
    const p = world.get(e, Position);
    const f = world.get(e, PathFollow); // present by the movers query above
    const snapshot = snapshotPool.pop() ?? { x: p.x, y: p.y, hx: f.hx, hy: f.hy };
    snapshot.x = p.x;
    snapshot.y = p.y;
    snapshot.hx = f.hx;
    snapshot.hy = f.hy;
    before.set(e, snapshot);
  }

  return { movers, firmMovers, before, moverIndex, postIndex };
}
