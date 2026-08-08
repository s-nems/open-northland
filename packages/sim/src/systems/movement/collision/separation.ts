import { Position } from '../../../components/index.js';
import { type Fixed, fx, ZERO } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../nav/halfcell.js';
import { worldDistance } from '../../../nav/world-metric.js';
import type { System } from '../../context.js';
import { MOVE_SPEED_PER_TICK } from '../system.js';
import { collectColliders } from './separation/colliders.js';
import { SeparationGates } from './separation/gates.js';
import { separationGridPoint, separationWorldPoint } from './separation/geometry.js';
import {
  clearGrind,
  OBSTRUCTED_MAX_REROUTES,
  OBSTRUCTED_PROGRESS_FLOOR,
  OBSTRUCTED_REROUTE_TICKS,
  updateObstruction,
} from './separation/obstruction.js';
import { type MoverSnapshot, separationScratch } from './separation/scratch.js';

export { OBSTRUCTED_MAX_REROUTES, OBSTRUCTED_PROGRESS_FLOOR, OBSTRUCTED_REROUTE_TICKS };

/**
 * A collider's body radius, in world-metric column units. Both half-cell lattice pitches bound it: above
 * half the E/W node pitch (0.25), so posts on horizontally adjacent nodes leave no slip line and a
 * one-per-node line is a closed wall, and below the N/S node pitch (19/68 ~ 0.2794), so a post never covers
 * a neighbouring node's centre and every free node stays exactly reachable. Impassability holds because a
 * mover advances at most its gait plus {@link SEPARATION_PUSH_CAP} per tick, always less than this radius.
 */
const UNIT_SEPARATION_RADIUS: Fixed = fx.div(fx.fromInt(13), fx.fromInt(50));

/**
 * The per-tick cap on the soft mover-vs-mover push, deliberately below the arrival brake floor
 * (`gait / ARRIVAL_SPEED_DIV` in `movement/system.ts`): a walker brushed by passing traffic still makes net
 * progress every tick, so soft separation can delay an arrival but never prevent one. The one bounded
 * exception is a from-rest walker's first acceleration-ramp tick, which advances only gait/3 and so can
 * regress for that single tick. Approximation: two fifths of the gait, just under the half floor.
 */
const SEPARATION_PUSH_CAP: Fixed = fx.div(fx.mul(MOVE_SPEED_PER_TICK, fx.fromInt(2)), fx.fromInt(5));

/**
 * Minimum unit-heading dot product for two overlapping movers to count as a convoy rather than crossing
 * traffic: a half, so within 60 degrees. A convoy pair resolves by the follower braking in line, with no
 * lateral component, so shared-lane walkers form a column instead of shoving each other sideways, while
 * anything closer to perpendicular keeps the radial sidestep. Approximation with no original counterpart.
 */
const CONVOY_ALIGNMENT_MIN: Fixed = fx.div(fx.fromInt(1), fx.fromInt(2));

/**
 * Resolves this tick's body overlaps, right after the MovementSystem; `bodies.ts` holds the tier model and
 * its source basis. Only movers are displaced: a mover-vs-mover overlap resolves softly, as a convoy brake
 * or a radial split of half the overlap each, while a firm mover additionally ejects fully back onto the
 * radius of a post it overlaps, so a post is impenetrable but never jitters. A displaced position must land
 * on walkable, unblocked ground, or the offending axis and then the whole displacement is discarded.
 *
 * Movers are processed in ascending entity id, mover-vs-mover pushes read the tick's pre-separation
 * snapshot, and post resolutions apply in bucket-scan order, so no result depends on store order.
 */
export const separationSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: no lattice to collide on

  const scratch = separationScratch(world);
  const colliders = collectColliders(world, ctx, scratch);
  if (colliders === null) return; // nobody walking, so nothing can overlap anything
  const { movers, firmMovers, before, moverIndex, postIndex } = colliders;
  const gates = new SeparationGates(world, ctx, terrain, scratch.ghostMemo);
  const { nearMovers, nearPosts } = scratch;

  for (const e of movers) {
    const start = before.get(e);
    if (start === undefined) continue; // every mover is in `before`; this only satisfies the checked access
    const nodeHx = nodeHxOfPosition(start.x, start.y);
    const nodeHy = nodeHyOfPosition(start.y);
    const isFirm = firmMovers.has(e);

    // The radius is below both bucket pitches, so every body within reach lives in the 3x3 bucket block
    // around the mover's own node. Posts matter only to a firm mover.
    nearMovers.length = 0;
    nearPosts.length = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const n of moverIndex.at(nodeHx + dx, nodeHy + dy)) {
          if (n !== e) nearMovers.push(n);
        }
        if (isFirm) nearPosts.push(...postIndex.at(nodeHx + dx, nodeHy + dy));
      }
    }
    if (nearMovers.length === 0 && nearPosts.length === 0) {
      if (isFirm) clearGrind(world, e);
      continue;
    }
    // A firm mover in its own town drops to the soft tier: no post resolve and no grind.
    const ghost = isFirm && gates.isGhost(e);

    const push = resolveMoverPush(e, start, nearMovers, before);

    const p = world.get(e, Position);
    let cand = { x: p.x, y: p.y };
    if (push.x !== ZERO || push.y !== ZERO) {
      const candW = separationWorldPoint(p.x, p.y);
      cand = separationGridPoint({ x: fx.add(candW.x, push.x), y: fx.add(candW.y, push.y) });
    }

    // Only a firm mover outside its own calm zone ejects off posts; everyone else keeps the soft candidate.
    if (!ghost) cand = resolveAgainstPosts(e, cand, nearPosts, world);

    // Drop the offending axis, then the whole displacement: the walker's own path point always stands.
    // Mut only on a landed displacement, so a crowd standing in equilibrium does not churn the touched log.
    if (cand.x !== p.x || cand.y !== p.y) {
      if (gates.allowsLanding(cand.x, cand.y)) {
        const moved = world.mut(e, Position);
        moved.x = cand.x;
        moved.y = cand.y;
      } else if (gates.allowsLanding(cand.x, p.y)) {
        world.mut(e, Position).x = cand.x;
      } else if (gates.allowsLanding(p.x, cand.y)) {
        world.mut(e, Position).y = cand.y;
      }
    }

    updateObstruction(world, e, isFirm, ghost, nearPosts, nearMovers, firmMovers);
  }
};

/**
 * The soft tier: this mover's mover-vs-mover push for the tick, read from the pre-separation snapshot
 * (`before`) alone so the pairwise split is order-independent, and capped at {@link SEPARATION_PUSH_CAP}.
 */
function resolveMoverPush(
  e: Entity,
  start: Readonly<MoverSnapshot>,
  nearMovers: readonly Entity[],
  before: ReadonlyMap<Entity, Readonly<MoverSnapshot>>,
): { x: Fixed; y: Fixed } {
  const startW = separationWorldPoint(start.x, start.y);
  let pushX = ZERO;
  let pushY = ZERO;
  for (const n of nearMovers) {
    const other = before.get(n);
    if (other === undefined) continue;
    const dist = worldDistance(start.x, start.y, other.x, other.y);
    if (dist >= UNIT_SEPARATION_RADIUS) continue;
    const half = fx.div(fx.sub(UNIT_SEPARATION_RADIUS, dist), fx.fromInt(2));
    const otherW = separationWorldPoint(other.x, other.y);
    // (0, 0) is the "no established heading" sentinel: such a pair falls through to the radial split.
    if ((start.hx !== ZERO || start.hy !== ZERO) && (other.hx !== ZERO || other.hy !== ZERO)) {
      const alignment = fx.add(fx.mul(start.hx, other.hx), fx.mul(start.hy, other.hy));
      if (alignment >= CONVOY_ALIGNMENT_MIN) {
        const ahead = fx.add(
          fx.mul(fx.sub(otherW.x, startW.x), start.hx),
          fx.mul(fx.sub(otherW.y, startW.y), start.hy),
        );
        // Exactly abreast or stacked: the higher id yields, seeding the fore and aft order the geometric
        // test then keeps stable. Known gap: a follower on a faster gait out-closes the capped brake and
        // briefly merges.
        if (ahead > ZERO || (ahead === ZERO && e > n)) {
          pushX = fx.sub(pushX, fx.mul(start.hx, half));
          pushY = fx.sub(pushY, fx.mul(start.hy, half));
          continue; // braked in line, no radial component
        }
        // The leader skips its counter-shove only when the other side will brake. Both iterations read the
        // same snapshot, so this prediction equals the other side's own decision exactly.
        const otherAhead = fx.add(
          fx.mul(fx.sub(startW.x, otherW.x), other.hx),
          fx.mul(fx.sub(startW.y, otherW.y), other.hy),
        );
        if (otherAhead > ZERO || (otherAhead === ZERO && n > e)) continue;
      }
    }
    if (dist === ZERO) {
      // Exactly stacked crossing traffic: split along E/W by id order, a named pick.
      pushX = fx.add(pushX, e < n ? fx.sub(ZERO, half) : half);
    } else {
      pushX = fx.add(pushX, fx.mulDiv(fx.sub(startW.x, otherW.x), half, dist));
      pushY = fx.add(pushY, fx.mulDiv(fx.sub(startW.y, otherW.y), half, dist));
    }
  }
  if (pushX !== ZERO || pushY !== ZERO) {
    const mag = fx.isqrt(fx.add(fx.mul(pushX, pushX), fx.mul(pushY, pushY)));
    if (mag > SEPARATION_PUSH_CAP) {
      pushX = fx.mulDiv(pushX, SEPARATION_PUSH_CAP, mag);
      pushY = fx.mulDiv(pushY, SEPARATION_PUSH_CAP, mag);
    }
  }
  return { x: pushX, y: pushY };
}

/**
 * The firm tier: place `cand` back onto the radius of each post it overlaps, in the bucket-scan order the
 * caller passes `nearPosts` in, so the last overlapped post in that order wins a conflict.
 */
function resolveAgainstPosts(
  e: Entity,
  cand: { x: Fixed; y: Fixed },
  nearPosts: readonly Entity[],
  world: World,
): { x: Fixed; y: Fixed } {
  let out = cand;
  for (const s of nearPosts) {
    const sp = world.get(s, Position);
    const dist = worldDistance(out.x, out.y, sp.x, sp.y);
    if (dist >= UNIT_SEPARATION_RADIUS) continue;
    const postW = separationWorldPoint(sp.x, sp.y);
    const candW = separationWorldPoint(out.x, out.y);
    let outX: Fixed;
    let outY: Fixed;
    if (dist === ZERO) {
      // Exactly on the post: eject east/west by id order (a named pick).
      outX = e < s ? fx.sub(ZERO, UNIT_SEPARATION_RADIUS) : UNIT_SEPARATION_RADIUS;
      outY = ZERO;
    } else {
      outX = fx.mulDiv(fx.sub(candW.x, postW.x), UNIT_SEPARATION_RADIUS, dist);
      outY = fx.mulDiv(fx.sub(candW.y, postW.y), UNIT_SEPARATION_RADIUS, dist);
    }
    out = separationGridPoint({ x: fx.add(postW.x, outX), y: fx.add(postW.y, outY) });
  }
  return out;
}
