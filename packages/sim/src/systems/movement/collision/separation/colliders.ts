import { Obstructed, PathFollow, PathRoute, Position, Settler } from '../../../../components/index.js';
import { ZERO } from '../../../../core/fixed.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { NodeBuckets } from '../../../spatial/nodes.js';
import { writeLegHeading } from '../../stepping.js';
import { hasBodyCollision, hasSoftCollision, isStanding } from '../bodies.js';
import type { MoverSnapshot, SeparationScratch } from './scratch.js';

export interface TickColliders {
  /** Ascending id. */
  readonly movers: readonly Entity[];
  /**
   * Every mover's pre-separation position, unit world heading toward the current stop and tier, so a pair's
   * two halves read the same state whatever the processing order. A live heading read would be
   * order-dependent and can throw, since the grind bookkeeping drops an earlier-processed mover's
   * PathFollow mid-loop.
   */
  readonly before: ReadonlyMap<Entity, Readonly<MoverSnapshot>>;
  readonly moverIndex: NodeBuckets;
  readonly postIndex: NodeBuckets;
}

const ascending = (a: Entity, b: Entity): number => a - b;

/** Null when nobody is walking - the dormancy exit, since nothing can overlap anything. */
export function collectColliders(
  world: World,
  ctx: SystemContext,
  scratch: SeparationScratch,
): TickColliders | null {
  const { movers, posts, before, snapshotPool } = scratch;
  const census = ++scratch.census;
  let moverCount = 0;
  let firmCount = 0;
  for (const e of world.query(PathFollow, Position)) {
    if (!hasSoftCollision(world, e)) continue;
    movers[moverCount++] = e;
    let snapshot = before.get(e);
    if (snapshot === undefined) {
      snapshot = snapshotPool.pop() ?? { x: ZERO, y: ZERO, hx: ZERO, hy: ZERO, firm: false, census };
      before.set(e, snapshot);
    }
    snapshot.census = census;
    snapshot.firm = hasBodyCollision(world, ctx.content, e);
    if (snapshot.firm) firmCount++;
  }
  movers.length = moverCount;
  for (const e of before.keys()) {
    const snapshot = before.get(e);
    if (snapshot === undefined || snapshot.census === census) continue;
    before.delete(e);
    snapshotPool.push(snapshot);
  }
  // Before the dormancy exit: a grind ends on arrival, a re-route, or a profession change out of the
  // fighting trades, and none of those walk, so its holder is never in `movers`.
  for (const e of world.canonicalQuery(Obstructed)) {
    if (!world.has(e, PathFollow) || !hasBodyCollision(world, ctx.content, e)) world.remove(e, Obstructed);
  }
  if (moverCount === 0) return null;
  movers.sort(ascending);

  // The immovable posts firm movers resolve against, scanned only when a firm mover exists: soft-only
  // traffic (a civilian economy tick) never reads the index, so it skips the full-settler scan entirely.
  let postCount = 0;
  if (firmCount > 0) {
    for (const e of world.query(Settler, Position)) {
      if (hasBodyCollision(world, ctx.content, e) && isStanding(world, e)) posts[postCount++] = e;
    }
  }
  posts.length = postCount;
  posts.sort(ascending);
  const postIndex = new NodeBuckets(world, posts);
  const moverIndex = new NodeBuckets(world, movers);

  for (const e of movers) {
    const p = world.get(e, Position);
    const snapshot = before.get(e);
    if (snapshot === undefined) continue; // every mover got one in the census above
    snapshot.x = p.x;
    snapshot.y = p.y;
    // Both present by the movers query above.
    const target = world.get(e, PathRoute).waypoints[world.get(e, PathFollow).index];
    if (target === undefined) {
      snapshot.hx = ZERO;
      snapshot.hy = ZERO;
    } else {
      writeLegHeading(p, target, snapshot);
    }
  }

  return { movers, before, moverIndex, postIndex };
}
