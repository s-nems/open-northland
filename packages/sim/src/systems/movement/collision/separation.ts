import { Position } from '../../../components/index.js';
import { type Fixed, fx, ZERO } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition, positionXOfWorld } from '../../../nav/halfcell.js';
import { worldDistance, worldX } from '../../../nav/world-metric.js';
import type { System } from '../../context.js';
import { REFERENCE_PACE_PER_TICK } from '../system.js';
import { collectColliders } from './separation/colliders.js';
import { SeparationGates } from './separation/gates.js';
import { gridYOf, worldYOf } from './separation/geometry.js';
import {
  clearGrind,
  OBSTRUCTED_MAX_REROUTES,
  OBSTRUCTED_PROGRESS_FLOOR,
  OBSTRUCTED_REROUTE_TICKS,
  updateObstruction,
} from './separation/obstruction.js';
import { type MoverSnapshot, type ScratchPoint, separationScratch } from './separation/scratch.js';

export { OBSTRUCTED_MAX_REROUTES, OBSTRUCTED_PROGRESS_FLOOR, OBSTRUCTED_REROUTE_TICKS };

/**
 * A collider's body radius, in world-metric column units. Both half-cell lattice pitches bound it: above
 * half the E/W node pitch (0.25), so posts on horizontally adjacent nodes leave no slip line and a
 * one-per-node line is a closed wall, and below the N/S node pitch (19/68 ~ 0.2794), so a post never covers
 * a neighbouring node's centre and every free node stays exactly reachable. Impassability holds because a
 * mover advances at most `MAX_STEP_PER_TICK` plus {@link SEPARATION_PUSH_CAP} per tick, always less than
 * this radius.
 */
const UNIT_SEPARATION_RADIUS: Fixed = fx.div(fx.fromInt(13), fx.fromInt(50));

/**
 * The per-tick cap on the soft mover-vs-mover push, below the reference walker's per-tick advance so a
 * walker brushed by passing traffic still makes net progress every tick; the slowest legs (snow, laden,
 * script-slowed) can lose ground for a tick. Either way soft separation only delays an arrival: a leg
 * pushed behind schedule keeps closing at up to `MAX_STEP_PER_TICK` until it lands. Approximation: two
 * fifths of the reference pace.
 */
const SEPARATION_PUSH_CAP: Fixed = fx.div(fx.mul(REFERENCE_PACE_PER_TICK, fx.fromInt(2)), fx.fromInt(5));

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
  const { movers, before, moverIndex, postIndex } = colliders;
  const gates = new SeparationGates(world, ctx, terrain, scratch.ghostMemo);
  const { nearMovers, nearPosts, push, candidate } = scratch;

  for (const e of movers) {
    const start = before.get(e);
    if (start === undefined) continue; // every mover is in `before`; this only satisfies the checked access
    const nodeHx = nodeHxOfPosition(start.x, start.y);
    const nodeHy = nodeHyOfPosition(start.y);
    const isFirm = start.firm;

    // The radius is below both bucket pitches, so every body within reach lives in the 3x3 bucket block
    // around the mover's own node. Posts matter only to a firm mover. Indexed loops and count-bound lists
    // keep this pass allocation-free: `for...of` allocated an iterator per bucket, and `length = 0` drops
    // an array's storage.
    let moverCount = 0;
    let postCount = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = moverIndex.at(nodeHx + dx, nodeHy + dy);
        for (let i = 0; i < bucket.length; i++) {
          const n = bucket[i];
          if (n !== undefined && n !== e) nearMovers[moverCount++] = n;
        }
        if (!isFirm) continue;
        const posts = postIndex.at(nodeHx + dx, nodeHy + dy);
        for (let i = 0; i < posts.length; i++) {
          const post = posts[i];
          if (post !== undefined) nearPosts[postCount++] = post;
        }
      }
    }
    if (moverCount === 0 && postCount === 0) {
      if (isFirm) clearGrind(world, e);
      continue;
    }
    // A firm mover in its own town drops to the soft tier: no post resolve and no grind.
    const ghost = isFirm && gates.isGhost(e);

    resolveMoverPush(e, start, nearMovers, moverCount, before, push);

    const p = world.get(e, Position);
    candidate.x = p.x;
    candidate.y = p.y;
    if (push.x !== ZERO || push.y !== ZERO) {
      const y = gridYOf(fx.add(worldYOf(p.y), push.y));
      candidate.x = positionXOfWorld(fx.add(worldX(p.x, p.y), push.x), y);
      candidate.y = y;
    }

    // Only a firm mover outside its own calm zone ejects off posts; everyone else keeps the soft candidate.
    if (!ghost) resolveAgainstPosts(e, candidate, nearPosts, postCount, world);

    // Drop the offending axis, then the whole displacement: the walker's own path point always stands.
    // Mut only on a landed displacement, so a crowd standing in equilibrium does not churn the touched log.
    if (candidate.x !== p.x || candidate.y !== p.y) {
      if (gates.allowsLanding(candidate.x, candidate.y)) {
        const moved = world.mut(e, Position);
        moved.x = candidate.x;
        moved.y = candidate.y;
      } else if (gates.allowsLanding(candidate.x, p.y)) {
        world.mut(e, Position).x = candidate.x;
      } else if (gates.allowsLanding(p.x, candidate.y)) {
        world.mut(e, Position).y = candidate.y;
      }
    }

    const firmNear = postCount > 0 || someFirm(nearMovers, moverCount, before);
    updateObstruction(world, e, isFirm, ghost, firmNear);
  }
};

/**
 * The soft tier: this mover's mover-vs-mover push for the tick, written to `push` in world axes. Read from
 * the pre-separation snapshot (`before`) alone so the pairwise split is order-independent, and capped at
 * {@link SEPARATION_PUSH_CAP}.
 */
function resolveMoverPush(
  e: Entity,
  start: Readonly<MoverSnapshot>,
  nearMovers: readonly Entity[],
  moverCount: number,
  before: ReadonlyMap<Entity, Readonly<MoverSnapshot>>,
  push: ScratchPoint,
): void {
  const startWX = worldX(start.x, start.y);
  const startWY = worldYOf(start.y);
  let pushX = ZERO;
  let pushY = ZERO;
  for (let i = 0; i < moverCount; i++) {
    const n = nearMovers[i];
    if (n === undefined) continue;
    const other = before.get(n);
    if (other === undefined) continue;
    const dist = worldDistance(start.x, start.y, other.x, other.y);
    if (dist >= UNIT_SEPARATION_RADIUS) continue;
    const half = fx.div(fx.sub(UNIT_SEPARATION_RADIUS, dist), fx.fromInt(2));
    const otherWX = worldX(other.x, other.y);
    const otherWY = worldYOf(other.y);
    // (0, 0) is the "no established heading" sentinel: such a pair falls through to the radial split.
    if ((start.hx !== ZERO || start.hy !== ZERO) && (other.hx !== ZERO || other.hy !== ZERO)) {
      const alignment = fx.add(fx.mul(start.hx, other.hx), fx.mul(start.hy, other.hy));
      if (alignment >= CONVOY_ALIGNMENT_MIN) {
        const ahead = fx.add(
          fx.mul(fx.sub(otherWX, startWX), start.hx),
          fx.mul(fx.sub(otherWY, startWY), start.hy),
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
          fx.mul(fx.sub(startWX, otherWX), other.hx),
          fx.mul(fx.sub(startWY, otherWY), other.hy),
        );
        if (otherAhead > ZERO || (otherAhead === ZERO && n > e)) continue;
      }
    }
    if (dist === ZERO) {
      // Exactly stacked crossing traffic: split along E/W by id order, a named pick.
      pushX = fx.add(pushX, e < n ? fx.sub(ZERO, half) : half);
    } else {
      pushX = fx.add(pushX, fx.mulDiv(fx.sub(startWX, otherWX), half, dist));
      pushY = fx.add(pushY, fx.mulDiv(fx.sub(startWY, otherWY), half, dist));
    }
  }
  if (pushX !== ZERO || pushY !== ZERO) {
    const mag = fx.isqrt(fx.add(fx.mul(pushX, pushX), fx.mul(pushY, pushY)));
    if (mag > SEPARATION_PUSH_CAP) {
      pushX = fx.mulDiv(pushX, SEPARATION_PUSH_CAP, mag);
      pushY = fx.mulDiv(pushY, SEPARATION_PUSH_CAP, mag);
    }
  }
  push.x = pushX;
  push.y = pushY;
}

/**
 * The firm tier: move `cand` back onto the radius of each post it overlaps, in the bucket-scan order the
 * caller passes `nearPosts` in, so the last overlapped post in that order wins a conflict.
 */
function resolveAgainstPosts(
  e: Entity,
  cand: ScratchPoint,
  nearPosts: readonly Entity[],
  postCount: number,
  world: World,
): void {
  for (let i = 0; i < postCount; i++) {
    const s = nearPosts[i];
    if (s === undefined) continue;
    const sp = world.get(s, Position);
    const dist = worldDistance(cand.x, cand.y, sp.x, sp.y);
    if (dist >= UNIT_SEPARATION_RADIUS) continue;
    const postWX = worldX(sp.x, sp.y);
    const postWY = worldYOf(sp.y);
    let outX: Fixed;
    let outY: Fixed;
    if (dist === ZERO) {
      // Exactly on the post: eject east/west by id order (a named pick).
      outX = e < s ? fx.sub(ZERO, UNIT_SEPARATION_RADIUS) : UNIT_SEPARATION_RADIUS;
      outY = ZERO;
    } else {
      outX = fx.mulDiv(fx.sub(worldX(cand.x, cand.y), postWX), UNIT_SEPARATION_RADIUS, dist);
      outY = fx.mulDiv(fx.sub(worldYOf(cand.y), postWY), UNIT_SEPARATION_RADIUS, dist);
    }
    const y = gridYOf(fx.add(postWY, outY));
    cand.x = positionXOfWorld(fx.add(postWX, outX), y);
    cand.y = y;
  }
}

function someFirm(
  near: readonly Entity[],
  count: number,
  before: ReadonlyMap<Entity, Readonly<MoverSnapshot>>,
): boolean {
  for (let i = 0; i < count; i++) {
    const n = near[i];
    if (n !== undefined && before.get(n)?.firm === true) return true;
  }
  return false;
}
