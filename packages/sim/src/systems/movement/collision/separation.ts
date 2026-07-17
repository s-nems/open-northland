import { Obstructed, Owner, PathFollow, Position, Settler } from '../../../components/index.js';
import { type Fixed, fx, ZERO } from '../../../core/fixed.js';
import type { Entity } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import { worldDistance } from '../../../nav/metric.js';
import type { BlockOverlay, NodeId } from '../../../nav/terrain/index.js';
import type { System } from '../../context.js';
import { dynamicBlockOverlay } from '../../footprint/index.js';
import { canonicalById, NodeBuckets } from '../../spatial.js';
import { MOVE_SPEED_PER_TICK } from '../movement.js';
import { calmZonesByPlayer, hasBodyCollision, hasSoftCollision, isStanding } from './bodies.js';
import { separationGridPoint, separationWorldPoint } from './separation/geometry.js';
import {
  clearGrind,
  OBSTRUCTED_MAX_REROUTES,
  OBSTRUCTED_PROGRESS_FLOOR,
  OBSTRUCTED_REROUTE_TICKS,
  updateObstruction,
} from './separation/obstruction.js';
import { separationScratch } from './separation/scratch.js';

export { OBSTRUCTED_MAX_REROUTES, OBSTRUCTED_PROGRESS_FLOOR, OBSTRUCTED_REROUTE_TICKS };

/**
 * A collider's body radius, in world-metric column units. The bounds are the half-cell lattice's own
 * pitches, and both matter:
 *  - > half the E/W node pitch (0.25) — posts standing on horizontally adjacent nodes leave no zero-width
 *    slip line between their radii, so a one-per-node line is a closed wall;
 *  - < the N/S node pitch (19/68 ≈ 0.2794) — a post never covers a neighbouring node's centre, so any free
 *    node stays exactly reachable and a melee attacker on an adjacent node stands clear of its target's body.
 * Impassability holds because a mover advances at most its gait + {@link SEPARATION_PUSH_CAP} (= 0.2 at the
 * fleeing run pace: gait 1/6 + cap 1/30) per tick — always less than this radius, so it can never step from
 * outside a post's radius past the post's centre in one tick, and the full resolve returns it to the near side.
 */
const UNIT_SEPARATION_RADIUS: Fixed = fx.div(fx.fromInt(13), fx.fromInt(50));

/**
 * The per-tick cap on the soft mover-vs-mover push, deliberately below the arrival brake floor
 * (`gait / ARRIVAL_SPEED_DIV`, see `movement.ts`): a walker being brushed by passing traffic still makes net
 * progress every tick, so soft separation can delay an arrival but never prevent one. (One bounded exception:
 * a from-rest walker's very first acceleration-ramp tick advances only gait/3 < this cap, so a fully-braked
 * launch can regress ~gait/15 for that single tick — the ramp outruns the cap from tick two.) Tuned to ⅖ of
 * the gait (just under the ½ floor).
 */
const SEPARATION_PUSH_CAP: Fixed = fx.div(fx.mul(MOVE_SPEED_PER_TICK, fx.fromInt(2)), fx.fromInt(5));

/**
 * Minimum heading alignment (unit-heading dot product — the cosine of the angle between two walks) for two
 * overlapping movers to count as a convoy (same-lane traffic) rather than crossing traffic: ½ = within 60°. A
 * convoy pair resolves by the follower braking in line behind the leader — no lateral component — so
 * shared-lane walkers form a column instead of shoving each other sideways on every step; anything closer to
 * perpendicular keeps the radial sidestep that lets head-on and crossing walkers slip past. A feel-tuning
 * constant with no original counterpart.
 */
const CONVOY_ALIGNMENT_MIN: Fixed = fx.div(fx.fromInt(1), fx.fromInt(2));

/**
 * SeparationSystem — runs right after the MovementSystem and resolves this tick's body overlaps (see
 * `bodies.ts` for the two-tier model and its source basis). Displaces movers only: mover-vs-mover overlap
 * resolves softly for every owned walking settler (capped at {@link SEPARATION_PUSH_CAP} — the "walking units
 * never merge" tier) and is direction-aware: same-lane pairs ({@link CONVOY_ALIGNMENT_MIN}) column up — the
 * follower brakes in behind the leader — while crossing/head-on pairs split radially, half the overlap each.
 * Only firm movers (owned fighters) additionally resolve fully against posts (placed back on the post's
 * radius), so a post is impenetrable but never jitters and a civilian never wedges on a standing body. A
 * displaced position must land on walkable, unblocked ground or the offending axis (then the whole
 * displacement) is discarded, so collision can never push a body into water or through a wall.
 *
 * Determinism: movers are processed in ascending entity id; mover-vs-mover pushes read the tick's
 * pre-separation position snapshot (order-independent by construction); mover-vs-post resolutions apply in the
 * 3×3 bucket-scan order around the mover's node (ascending post id within each bucket) — a fixed,
 * history-independent order; every quantity is fixed-point via `fx.*`. Scale: per-tick cost is O(colliders) to
 * bucket plus O(movers × local crowd) to resolve — cost follows units actually walking, and a mapless sim
 * exits immediately.
 */
export const separationSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: no lattice to collide on

  // Soft movers currently walking — the only entities this system ever displaces. The firm subset (owned
  // fighters) additionally resolves against posts and keeps the obstruction grind window.
  const scratch = separationScratch(world);
  const { movers, firmMovers } = scratch;
  for (const e of world.query(PathFollow, Position)) {
    if (!hasSoftCollision(world, e)) continue;
    movers.push(e);
    if (hasBodyCollision(world, e)) firmMovers.add(e);
  }
  // An Obstructed counter survives only on a firm walker: arrival/re-route/re-tasking ends the grind, and a
  // profession change away from the fighting trades sheds it with the firm tier.
  for (const e of canonicalById(world.query(Obstructed))) {
    if (!world.has(e, PathFollow) || !hasBodyCollision(world, e)) world.remove(e, Obstructed);
  }
  if (movers.length === 0) return; // dormancy: nobody walking → nothing can overlap anything
  movers.sort((a, b) => a - b);

  // Standing colliders — the immovable posts firm movers resolve against. Derived only when a firm mover
  // exists: soft-only traffic (a civilian economy tick) never reads the index, so it skips the full-settler
  // scan + sort entirely.
  const { posts } = scratch;
  if (firmMovers.size > 0) {
    for (const e of world.query(Settler, Position)) {
      if (hasBodyCollision(world, e) && isStanding(world, e)) posts.push(e);
    }
  }
  const postIndex = new NodeBuckets(world, canonicalById(posts));
  const moverIndex = new NodeBuckets(world, movers);

  // The tick's pre-separation mover snapshot — positions and headings — so a pair's two halves are computed
  // from the same state regardless of processing order. Headings must come from the snapshot, not a live
  // component read: the grind bookkeeping below can drop an earlier-processed mover's PathFollow mid-loop (a
  // re-route/stand-down in a converging crowd), so a live read on a later mover's neighbour would throw — and
  // would make the pair split order-dependent.
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

  // Lazy shared per-tick state: zones/overlay are built only if some pair actually interacts.
  let zones: Map<number, Set<NodeId>> | undefined;
  const { ghostMemo } = scratch;
  const isGhostMover = (e: Entity): boolean => {
    let ghost = ghostMemo.get(e);
    if (ghost === undefined) {
      zones ??= calmZonesByPlayer(world, terrain, ctx.tick);
      const p = world.get(e, Position);
      const n = nodeOfPosition(p.x, p.y);
      ghost =
        terrain.inBounds(n.hx, n.hy) &&
        (zones.get(world.get(e, Owner).player)?.has(terrain.nodeAt(n.hx, n.hy)) ?? false);
      ghostMemo.set(e, ghost);
    }
    return ghost;
  };
  let blockedOverlay: BlockOverlay | undefined;
  const safeLanding = (x: Fixed, y: Fixed): boolean => {
    const n = nodeOfPosition(x, y);
    if (!terrain.inBounds(n.hx, n.hy)) return false;
    const node = terrain.nodeAt(n.hx, n.hy);
    if (!terrain.isWalkable(node)) return false;
    blockedOverlay ??= dynamicBlockOverlay(world, ctx, terrain);
    return !blockedOverlay.has(node);
  };

  for (const e of movers) {
    const start = before.get(e);
    if (start === undefined) continue; // movers ⊆ before by construction; guard for the checked access
    const node = nodeOfPosition(start.x, start.y);
    const isFirm = firmMovers.has(e);

    // Gather this mover's neighbourhood. Radius < both bucket pitches, so bodies within reach live in the 3×3
    // bucket block around the mover's own node (truncation adds at most one node). Posts matter only to a firm
    // mover — a civilian passes through every standing body.
    const { nearMovers, nearPosts } = scratch;
    nearMovers.length = 0;
    nearPosts.length = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const n of moverIndex.at(node.hx + dx, node.hy + dy)) {
          if (n !== e) nearMovers.push(n);
        }
        if (isFirm) nearPosts.push(...postIndex.at(node.hx + dx, node.hy + dy));
      }
    }
    if (nearMovers.length === 0 && nearPosts.length === 0) {
      if (isFirm) clearGrind(world, e);
      continue;
    }
    // A firm mover in its own town drops to the soft tier (no post resolve, no grind): fighters queueing at
    // their own stores never wedge. The soft nudge below stays on for everyone — capped under the arrival
    // brake floor, it cannot jam town flow, only un-merge the sprites.
    const ghost = isFirm && isGhostMover(e);

    // Soft half — direction-aware: overlapping same-lane traffic (heading dot ≥ {@link CONVOY_ALIGNMENT_MIN})
    // resolves as a convoy — the follower alone brakes along its own heading and falls in line behind the
    // leader, with no lateral component and no counter-shove on the leader — while crossing/head-on traffic
    // keeps the radial split (half the overlap each). Both read only the tick's pre-separation snapshot, so
    // the split is order-independent. The total is then capped.
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
      // (0,0) is the "no established heading" sentinel — such a pair can't be classified as a
      // convoy and falls through to the radial split.
      if ((start.hx !== ZERO || start.hy !== ZERO) && (other.hx !== ZERO || other.hy !== ZERO)) {
        const alignment = fx.add(fx.mul(start.hx, other.hx), fx.mul(start.hy, other.hy));
        if (alignment >= CONVOY_ALIGNMENT_MIN) {
          const ahead = fx.add(
            fx.mul(fx.sub(otherW.x, startW.x), start.hx),
            fx.mul(fx.sub(otherW.y, startW.y), start.hy),
          );
          // Exactly abreast (or stacked): the higher id yields — the keeper convention, a named pick that
          // seeds the fore/aft order the geometric test then keeps stable. With headings up to 60° apart both
          // sides can transiently read "follower" and brake — harmless (each keeps net progress under the cap,
          // and braking diverges them). Known feel gap: a same-lane follower on a faster gait (a fleeing run
          // behind a walk) out-closes the capped brake and passes through its leader — a brief merge.
          if (ahead > ZERO || (ahead === ZERO && e > n)) {
            pushX = fx.sub(pushX, fx.mul(start.hx, half));
            pushY = fx.sub(pushY, fx.mul(start.hy, half));
            continue; // braked in line — no radial component on a convoy follower
          }
          // This side reads itself as the leader. It skips the counter-shove only if the other side will
          // brake (the mirrored follower test — same snapshot inputs both iterations read, so e's prediction
          // equals n's own decision exactly). With headings apart and the offset near-perpendicular to both,
          // each side can read "leader"; such a pair would get no resolution and ride merged, so it falls
          // through to the radial split instead.
          const otherAhead = fx.add(
            fx.mul(fx.sub(startW.x, otherW.x), other.hx),
            fx.mul(fx.sub(startW.y, otherW.y), other.hy),
          );
          if (otherAhead > ZERO || (otherAhead === ZERO && n > e)) continue;
        }
      }
      if (dist === ZERO) {
        // Exactly stacked crossing traffic: split along E/W by id order — a named pick, not
        // iteration luck.
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

    const p = world.get(e, Position);
    let cand = { x: p.x, y: p.y };
    if (pushX !== ZERO || pushY !== ZERO) {
      const candW = separationWorldPoint(p.x, p.y);
      cand = separationGridPoint({ x: fx.add(candW.x, pushX), y: fx.add(candW.y, pushY) });
    }

    // Hard half — firm movers outside their own calm zone only (nearPosts is empty otherwise/for civilians):
    // place the mover back on each overlapped post's radius, in the bucket-scan order (see the system doc —
    // deterministic; each resolve rewrites `cand`, so the last overlapped post in that order wins a conflict).
    for (const s of ghost ? [] : nearPosts) {
      const sp = world.get(s, Position);
      const dist = worldDistance(cand.x, cand.y, sp.x, sp.y);
      if (dist >= UNIT_SEPARATION_RADIUS) continue;
      const postW = separationWorldPoint(sp.x, sp.y);
      const candW = separationWorldPoint(cand.x, cand.y);
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
      cand = separationGridPoint({ x: fx.add(postW.x, outX), y: fx.add(postW.y, outY) });
    }

    // Landing safety: never displace onto unwalkable/blocked ground — drop the offending axis, then
    // the whole displacement (the walker's own path point is always a legal stand).
    if (cand.x !== p.x || cand.y !== p.y) {
      if (safeLanding(cand.x, cand.y)) {
        p.x = cand.x;
        p.y = cand.y;
      } else if (safeLanding(cand.x, p.y)) {
        p.x = cand.x;
      } else if (safeLanding(p.x, cand.y)) {
        p.y = cand.y;
      }
    }

    updateObstruction(world, e, isFirm, ghost, nearPosts, nearMovers, firmMovers);
  }
};
