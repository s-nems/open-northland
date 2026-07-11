import { Obstructed, Owner, PathFollow, Position, Settler } from '../../../components/index.js';
import { type Fixed, ZERO, fx } from '../../../core/fixed.js';
import type { Entity } from '../../../ecs/world.js';
import { nodeOfPosition, positionXOfWorld } from '../../../nav/halfcell.js';
import { ROW_STEP, worldDistance, worldX } from '../../../nav/metric.js';
import type { NodeId } from '../../../nav/terrain.js';
import type { System } from '../../context.js';
import { dynamicBlockedCells } from '../../footprint/index.js';
import { NodeBuckets, canonicalById, clearNavState } from '../../spatial.js';
import { MOVE_SPEED_PER_TICK } from '../movement.js';
import { calmZonesByPlayer, hasBodyCollision, hasSoftCollision, isStanding } from './bodies.js';

/**
 * A collider's body radius, in world-metric column units. The bounds are the half-cell lattice's own
 * pitches, and both matter:
 *  - **> half the E/W node pitch (0.25)** — posts standing on horizontally adjacent nodes leave no
 *    zero-width slip line between their radii, so a one-per-node line is a closed wall;
 *  - **< the N/S node pitch (19/68 ≈ 0.2794)** — a post never covers a neighbouring node's CENTRE,
 *    so any free node stays exactly reachable (arrival is an exact position match) and a melee
 *    attacker on an adjacent node stands clear of its target's body.
 * Impassability holds because a mover advances at most its gait + {@link SEPARATION_PUSH_CAP}
 * (= 0.2 at the fleeing run pace: gait 1/6 + cap 1/30) per tick — always less than this radius, so
 * it can never step from outside a post's radius past the post's centre in one tick, and the full
 * resolve returns it to the near side every time.
 */
export const UNIT_SEPARATION_RADIUS: Fixed = fx.div(fx.fromInt(13), fx.fromInt(50));

/**
 * The per-tick cap on the SOFT mover-vs-mover push, deliberately below the arrival brake floor
 * (`gait / ARRIVAL_SPEED_DIV`, see `movement.ts`): a walker being brushed by passing traffic still
 * makes net progress every tick, so soft separation can delay an arrival but never prevent one.
 * (One bounded exception: a from-rest walker's very FIRST acceleration-ramp tick advances only
 * gait/3 < this cap, so a fully-braked launch can regress ~gait/15 for that single tick — the ramp
 * outruns the cap from tick two, so the invariant holds in the large.) Tuned to ⅖ of the gait
 * (just under the ½ floor): the first ¼ cut let a charging mass overlap deeply mid-march — a
 * converging army read as one pile of sprites (the feel note that raised it).
 */
export const SEPARATION_PUSH_CAP: Fixed = fx.div(fx.mul(MOVE_SPEED_PER_TICK, fx.fromInt(2)), fx.fromInt(5));

/**
 * Minimum heading alignment (unit-heading dot product — the cosine of the angle between two walks)
 * for two overlapping movers to count as a CONVOY (same-lane traffic) rather than crossing traffic:
 * ½ = within 60°. A convoy pair resolves by the FOLLOWER braking in line behind the leader — no
 * lateral component — so shared-lane walkers form a column instead of shoving each other sideways
 * on every step (the jostle report); anything closer to perpendicular keeps the radial sidestep
 * that lets head-on and crossing walkers slip past each other. A feel-tuning constant — no original
 * counterpart (the original has no collision at all).
 */
const CONVOY_ALIGNMENT_MIN: Fixed = fx.div(fx.fromInt(1), fx.fromInt(2));

/**
 * Consecutive {@link Obstructed} ticks (a grind window with bodies in the walker's immediate
 * neighbourhood and no real progress — see the component doc) before the walker DROPS ITS PATH and
 * lets its goal re-route — 0.2 s at 20 Hz: long enough to shoulder through a brush-past, short
 * enough that a walker never reads as marching in place against the first rank's backs (the
 * reported treadmill). Only the PathFollow is dropped — the MoveGoal stays — so the navigation
 * planner re-issues immediately against the CURRENT standing-body overlay: the fresh route flows
 * AROUND the blockers (the flanking behaviour), and where no way around exists the request FAILS
 * and the walker stands down at once (the failed-request rules in orders/combat), so a sealed wall
 * reads as "blocked, stops" within a fraction of a second.
 */
export const OBSTRUCTED_REROUTE_TICKS = 4;

/**
 * How many re-routes a walker attempts WITHOUT REACHING ITS GOAL before it stands down entirely
 * (the whole nav state dropped, exactly the old hard give-up) — the terminal backstop for a
 * contested destination that flanking can never resolve: e.g. a squad converging on one node,
 * where the last walkers' every stand-in keeps being taken by a fellow arrival and two stragglers
 * would otherwise orbit the ring re-planning forever. The goal's owner (a player-order hold, the
 * economy, a combat chase at its cadence) re-decides from wherever the unit stopped.
 */
export const OBSTRUCTED_MAX_REROUTES = 4;

/**
 * The GRIND-WINDOW progress floor, in world units PER TICK of window length — a third of the walk
 * gait. A contested mover whose total movement since its window anchor stays under `floor × ticks`
 * is going essentially nowhere (a head-on wedge, or the near-static tangential grind against a
 * crowded ring); the legitimate slow cases clear it: the acceleration ramp's slowest (first) tick
 * advances exactly gait/3, the arrival brake's ease-out is floored at gait/2 (`movement.ts`), and
 * sliding AROUND a lone post covers most of a step every tick. Named approximation: a firm CONVOY
 * follower simultaneously on its final-approach brake (gait/2) and a full convoy brake (−⅖ gait)
 * can dip under the floor; if a firm body also stays in its 3×3 block for a whole window, that's
 * one spurious re-route (path re-planned, goal kept) — rare, bounded, accepted.
 */
export const OBSTRUCTED_PROGRESS_FLOOR: Fixed = fx.div(MOVE_SPEED_PER_TICK, fx.fromInt(3));

/** A point in the lattice's WORLD axes (columns across, rows·ROW_STEP down — the `worldDistance`
 *  frame), where separation geometry is computed so every direction is priced by on-screen length. */
interface WorldPoint {
  x: Fixed;
  y: Fixed;
}

function toWorld(x: Fixed, y: Fixed): WorldPoint {
  return { x: worldX(x, y), y: fx.mul(y, ROW_STEP) };
}

/** The inverse of {@link toWorld}: a world-axis point back to Position grid coords. Truncates ≤ a
 *  couple of ulps — bounded, not accumulating (a walker re-snaps exactly onto every waypoint). */
function toGrid(w: WorldPoint): { x: Fixed; y: Fixed } {
  const y = fx.div(w.y, ROW_STEP);
  return { x: positionXOfWorld(w.x, y), y };
}

/**
 * SeparationSystem — runs right after the MovementSystem and resolves this tick's body overlaps
 * (see `bodies.ts` for the two-tier model and its source basis). Displaces MOVERS only:
 * mover-vs-mover overlap resolves softly for EVERY owned walking settler (capped at
 * {@link SEPARATION_PUSH_CAP} — the "walking units never merge" tier) and is DIRECTION-AWARE:
 * same-lane pairs ({@link CONVOY_ALIGNMENT_MIN}) column up — the follower brakes in behind the
 * leader — while crossing/head-on pairs split radially, half the overlap each. Only FIRM movers
 * (owned fighters) additionally resolve fully against posts (placed back on the post's radius), so
 * a post is impenetrable but never jitters and a civilian never wedges on a standing body. A
 * displaced position must land on walkable, unblocked ground or the offending axis (then the whole
 * displacement) is discarded, so collision can never push a body into water or through a wall.
 *
 * Determinism: movers are processed in ascending entity id; mover-vs-mover pushes read the tick's
 * pre-separation position snapshot (order-independent by construction); mover-vs-post resolutions
 * apply in the 3×3 bucket-scan order around the mover's node (ascending post id within each bucket)
 * — a fixed, history-independent order, since the buckets are keyed by integer node over a
 * canonical id-sorted list; every quantity is fixed-point via `fx.*`. Scale: per-tick cost is
 * O(colliders) to bucket plus O(movers × local crowd) to resolve — cost follows units actually
 * WALKING (active work, golden rule 7), and a mapless sim (the determinism golden) exits
 * immediately.
 */
export const separationSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: no lattice to collide on

  // SOFT movers currently walking — the only entities this system ever displaces. The FIRM subset
  // (owned fighters) additionally resolves against posts and keeps the obstruction grind window.
  const movers: Entity[] = [];
  const firmMovers = new Set<Entity>();
  for (const e of world.query(PathFollow, Position)) {
    if (!hasSoftCollision(world, e)) continue;
    movers.push(e);
    if (hasBodyCollision(world, e)) firmMovers.add(e);
  }
  // An Obstructed counter survives only on a FIRM walker: arrival/re-route/re-tasking ends the
  // grind, and a profession change away from the fighting trades sheds it with the firm tier.
  for (const e of canonicalById(world.query(Obstructed))) {
    if (!world.has(e, PathFollow) || !hasBodyCollision(world, e)) world.remove(e, Obstructed);
  }
  if (movers.length === 0) return; // dormancy: nobody walking → nothing can overlap anything
  movers.sort((a, b) => a - b);

  // Standing colliders — the immovable posts FIRM movers resolve against. Derived only when a firm
  // mover exists: soft-only traffic (a civilian economy tick) never reads the index (posts are
  // gathered under `isFirm` below), so it skips the full-settler scan + sort entirely.
  const posts: Entity[] = [];
  if (firmMovers.size > 0) {
    for (const e of world.query(Settler, Position)) {
      if (hasBodyCollision(world, e) && isStanding(world, e)) posts.push(e);
    }
  }
  const postIndex = new NodeBuckets(world, canonicalById(posts));
  const moverIndex = new NodeBuckets(world, movers);

  // The tick's pre-separation mover snapshot — positions AND headings — so a pair's two halves are
  // computed from the same state regardless of processing order. Headings MUST come from the
  // snapshot, not a live component read: the grind bookkeeping below can drop an earlier-processed
  // mover's PathFollow mid-loop (a re-route/stand-down in a converging crowd), so a live read on a
  // later mover's neighbour would throw — and would also make the pair split order-dependent.
  const before = new Map<Entity, { x: Fixed; y: Fixed; hx: Fixed; hy: Fixed }>();
  for (const e of movers) {
    const p = world.get(e, Position);
    const f = world.get(e, PathFollow); // present by the movers query above
    before.set(e, { x: p.x, y: p.y, hx: f.hx, hy: f.hy });
  }

  // Lazy shared per-tick state: zones/overlay are built only if some pair actually interacts.
  let zones: Map<number, Set<NodeId>> | undefined;
  const ghostMemo = new Map<Entity, boolean>();
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
  let blockedOverlay: ReadonlySet<NodeId> | undefined;
  const safeLanding = (x: Fixed, y: Fixed): boolean => {
    const n = nodeOfPosition(x, y);
    if (!terrain.inBounds(n.hx, n.hy)) return false;
    const node = terrain.nodeAt(n.hx, n.hy);
    if (!terrain.isWalkable(node)) return false;
    blockedOverlay ??= dynamicBlockedCells(world, ctx, terrain);
    return !blockedOverlay.has(node);
  };

  // A CLEAR tick (no body anywhere near) ends the current grind window but keeps the walk's
  // re-route tally — wiping it on every free stretch made the max-reroutes backstop unreachable
  // (each flanking detour zeroed the memory, so a fully contested destination was orbited forever).
  const clearGrind = (e: Entity): void => {
    const s = world.tryGet(e, Obstructed);
    if (s === undefined) return;
    if (s.reroutes === 0) {
      world.remove(e, Obstructed);
      return;
    }
    const p = world.get(e, Position);
    s.ticks = 0;
    s.x = p.x;
    s.y = p.y;
  };

  for (const e of movers) {
    const start = before.get(e);
    if (start === undefined) continue; // movers ⊆ before by construction; guard for the checked access
    const node = nodeOfPosition(start.x, start.y);
    const isFirm = firmMovers.has(e);

    // Gather this mover's neighbourhood. Radius < both bucket pitches, so bodies within reach live
    // in the 3×3 bucket block around the mover's own node (truncation adds at most one node).
    // Posts matter only to a FIRM mover — a civilian passes through every standing body.
    const nearMovers: Entity[] = [];
    const nearPosts: Entity[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const n of moverIndex.at(node.hx + dx, node.hy + dy)) {
          if (n !== e) nearMovers.push(n);
        }
        if (isFirm) nearPosts.push(...postIndex.at(node.hx + dx, node.hy + dy));
      }
    }
    if (nearMovers.length === 0 && nearPosts.length === 0) {
      if (isFirm) clearGrind(e);
      continue;
    }
    // A FIRM mover in its own town drops to the SOFT tier (no post resolve, no grind): fighters
    // queueing at their own stores never wedge. The soft nudge below stays on for everyone —
    // capped under the arrival brake floor, it cannot jam town flow, only un-merge the sprites.
    const ghost = isFirm && isGhostMover(e);

    // SOFT half — DIRECTION-AWARE: overlapping same-lane traffic (heading dot ≥
    // {@link CONVOY_ALIGNMENT_MIN}) resolves as a CONVOY — the follower alone brakes along its own
    // heading and falls in line behind the leader, with no lateral component and no counter-shove
    // on the leader — while crossing/head-on traffic keeps the radial split (half the overlap each,
    // the other half being the neighbour's own pass). Both read only the tick's pre-separation
    // snapshot (positions + headings), so the split is order-independent either way. The total is
    // then capped.
    const startW = toWorld(start.x, start.y);
    let pushX = ZERO;
    let pushY = ZERO;
    for (const n of nearMovers) {
      const other = before.get(n);
      if (other === undefined) continue;
      const dist = worldDistance(start.x, start.y, other.x, other.y);
      if (dist >= UNIT_SEPARATION_RADIUS) continue;
      const half = fx.div(fx.sub(UNIT_SEPARATION_RADIUS, dist), fx.fromInt(2));
      const otherW = toWorld(other.x, other.y);
      // (0,0) is the "no established heading" sentinel — such a pair can't be classified as a
      // convoy and falls through to the radial split.
      if ((start.hx !== ZERO || start.hy !== ZERO) && (other.hx !== ZERO || other.hy !== ZERO)) {
        const alignment = fx.add(fx.mul(start.hx, other.hx), fx.mul(start.hy, other.hy));
        if (alignment >= CONVOY_ALIGNMENT_MIN) {
          const ahead = fx.add(
            fx.mul(fx.sub(otherW.x, startW.x), start.hx),
            fx.mul(fx.sub(otherW.y, startW.y), start.hy),
          );
          // Exactly abreast (or stacked): the higher id yields — the keeper convention, a named
          // pick that seeds the fore/aft order the geometric test then keeps stable. With headings
          // up to 60° apart both sides can transiently read "follower" and brake — harmless (each
          // keeps net progress under the cap, and braking diverges them). Known feel gap: a
          // same-lane follower on a FASTER gait (a fleeing run behind a walk) out-closes the capped
          // brake and passes through its leader — a brief merge where crossing traffic would have
          // side-stepped.
          if (ahead > ZERO || (ahead === ZERO && e > n)) {
            pushX = fx.sub(pushX, fx.mul(start.hx, half));
            pushY = fx.sub(pushY, fx.mul(start.hy, half));
            continue; // braked in line — no radial component on a convoy follower
          }
          // This side reads itself as the LEADER. It skips the counter-shove only if the OTHER
          // side will brake (the mirrored follower test — same snapshot inputs both iterations
          // read, so e's prediction equals n's own decision exactly). With headings apart and the
          // offset near-perpendicular to both, EACH side can read "leader"; such a pair would get
          // no resolution at all and ride merged, so it falls through to the radial split instead.
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
      const candW = toWorld(p.x, p.y);
      cand = toGrid({ x: fx.add(candW.x, pushX), y: fx.add(candW.y, pushY) });
    }

    // HARD half — FIRM movers outside their own calm zone only (nearPosts is empty otherwise/for
    // civilians): place the mover back on each overlapped post's radius, in the bucket-scan order
    // (see the system doc — deterministic; each resolve rewrites `cand`, so the LAST overlapped
    // post in that order wins a conflict between two posts' radii).
    for (const s of ghost ? [] : nearPosts) {
      const sp = world.get(s, Position);
      const dist = worldDistance(cand.x, cand.y, sp.x, sp.y);
      if (dist >= UNIT_SEPARATION_RADIUS) continue;
      const postW = toWorld(sp.x, sp.y);
      const candW = toWorld(cand.x, cand.y);
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
      cand = toGrid({ x: fx.add(postW.x, outX), y: fx.add(postW.y, outY) });
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

    // GRIND-WINDOW bookkeeping (the Obstructed component doc) — FIRM movers among FIRM bodies only:
    // a civilian resolves against no posts and a soft brush never stops it (the push cap guarantees
    // net progress), so it can never be stuck and must never carry an Obstructed window; likewise a
    // firm mover surrounded only by soft traffic is merely in a crowd, not against a wall. While
    // firm bodies are near, measure the walker's TOTAL movement since the window's anchor. Any tick
    // that reaches the per-tick progress
    // floor × window length restarts the window — real progress, however indirect (a slide around a
    // lone post, a slow shove past a brush) — while a window that reaches the re-route threshold
    // with the walker still essentially at its anchor drops just its PATH (keeping its goal), so the
    // planner re-plans around the blockers ({@link OBSTRUCTED_REROUTE_TICKS}); after {@link
    // OBSTRUCTED_MAX_REROUTES} of those without ever arriving it stands down entirely — flanking is
    // not converging (a fully contested destination). Measured over a WINDOW (not per tick) because
    // this system runs after the MovementSystem and can't see one tick's walk step in isolation —
    // and a window is also what catches the near-static tangential grind against a crowded ring,
    // which a per-tick push-direction test never reads as blocked (stragglers orbited a contested
    // goal forever). The window's lifetime is the walk: arrival/stand-down sheds the component (the
    // sweep above), and a genuinely clear stretch re-anchors it ({@link clearGrind}).
    if (!isFirm) continue; // a soft-only mover never grinds
    const firmNear = nearPosts.length > 0 || nearMovers.some((n) => firmMovers.has(n));
    if (ghost || !firmNear) {
      clearGrind(e); // own town, or only soft traffic around — a crowd, not a wall
      continue;
    }
    const s =
      world.tryGet(e, Obstructed) ?? world.add(e, Obstructed, { ticks: 0, reroutes: 0, x: p.x, y: p.y });
    s.ticks += 1;
    const sinceAnchor = worldDistance(s.x, s.y, p.x, p.y);
    if (sinceAnchor >= fx.mul(OBSTRUCTED_PROGRESS_FLOOR, fx.fromInt(s.ticks))) {
      s.ticks = 0; // real progress — restart the window here (the re-route tally stays)
      s.x = p.x;
      s.y = p.y;
    } else if (s.ticks >= OBSTRUCTED_REROUTE_TICKS) {
      if (s.reroutes >= OBSTRUCTED_MAX_REROUTES) {
        clearNavState(world, e); // stand down where it is; the goal's owner re-decides
        world.remove(e, Obstructed);
      } else {
        world.remove(e, PathFollow);
        s.ticks = 0;
        s.x = p.x;
        s.y = p.y;
        s.reroutes += 1;
      }
    }
  }
};
