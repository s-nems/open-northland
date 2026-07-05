import { Fleeing, MoveSpeed, PathFollow, Position, Velocity } from '../../components/index.js';
import { type Fixed, fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System } from '../context.js';

/**
 * How far an entity following a {@link PathFollow} advances per tick, in fixed-point tile units.
 * Cell-centre waypoints are one tile apart, so at this speed an entity reaches the next waypoint in
 * eight ticks (a deliberate, tunable settler pace). A divisor of ONE keeps each step landing exactly
 * on integer fractions — no accumulated rounding drift — so two runs stay byte-identical.
 *
 * The magnitude is calibration-by-observation (no readable human `movespeed` exists — see
 * docs/FIDELITY.md "Movement step speed"): the earlier ¼ tile/tick read clearly TOO FAST against the
 * original (and made the walk skate — the 12-frame leg cycle spanned 3 tiles); at ⅛ a full leg cycle
 * covers 1.5 tiles and the on-screen pace matches the original's unhurried walk much closer.
 */
export const MOVE_SPEED_PER_TICK: Fixed = fx.div(fx.fromInt(1), fx.fromInt(8));

/**
 * How many times faster a **fleeing** unit runs than it walks — its run gait is the walk pace × this
 * multiplier when it carries no readable run speed of its own (a human: `animaltypes.ini` gives animals a
 * `runspeed` but humans have none). Set so a fleeing civilian clearly OUTPACES a walking pursuer (a
 * calibration constant — the original's run-vs-walk ratio is unreadable; docs/FIDELITY.md "Combat flee").
 * An integer multiple of the ⅛-tile walk keeps the run step dividing ONE evenly, so no rounding drift
 * enters — two runs stay byte-identical.
 */
export const RUN_SPEED_MULTIPLIER = 2;

/**
 * A fleeing unit's per-tick **run** gait: its own {@link MoveSpeed} `runPerTick` when it has one (a data-
 * pinned run pace — an animal's `runspeed`), else its walk pace ({@link MoveSpeed} `perTick`, or the
 * universal {@link MOVE_SPEED_PER_TICK}) × the {@link RUN_SPEED_MULTIPLIER} (a human's approximated run
 * speed). This is the code path that FIRST reads `runPerTick`, but only a fleeing entity carrying a
 * `MoveSpeed` reaches the first branch — and today only owned humans flee (via the FLEE stance) while
 * `MoveSpeed`/`runPerTick` is animal-only, so every real fleer takes the walk×multiplier fallback; the
 * animal run gait stays unexercised until an animal flee/charge drive lands (docs/FIDELITY.md "Animal
 * locomotion pace"). Pure fixed-point — a deterministic read.
 */
function runGait(world: World, e: Entity): Fixed {
  const ms = world.tryGet(e, MoveSpeed);
  if (ms?.runPerTick != null) return ms.runPerTick; // a data-pinned run gait (an animal's runspeed)
  const walk = ms?.perTick ?? MOVE_SPEED_PER_TICK;
  return fx.mul(walk, fx.fromInt(RUN_SPEED_MULTIPLIER)); // no readable human run speed → walk × multiplier
}

/**
 * MovementSystem — advances entity positions one tick.
 *
 * Two movement modes, in this precedence:
 *  1. {@link PathFollow}: step STRAIGHT toward the current waypoint's cell centre by the entity's own
 *     pace ({@link MoveSpeed}'s `perTick` if it carries one, else the universal {@link MOVE_SPEED_PER_TICK}),
 *     along the LINE to the waypoint so a diagonal leg advances at the same tiles/tick as an axis leg
 *     (no √2 speed-up from stepping each axis independently — {@link stepTowardPoint}). On reaching the
 *     waypoint, advance `index`; when the last waypoint is reached the path is complete and
 *     {@link PathFollow} is removed (the planner sees an entity with no path as idle/arrived). A
 *     path-following entity ignores any Velocity.
 *  2. {@link Velocity} (no PathFollow): the original constant-velocity integration — kept for the
 *     determinism golden and any free-moving entity that isn't path-driven.
 *
 * Fixed-point only; the straight-line step (isqrt homing, mirroring the projectile advance) means no
 * floats and no overshoot — a pure function of position + waypoint, so identical inputs yield identical
 * state. An AXIS leg is byte-identical to the old per-axis clamp; only diagonal legs change.
 */
export const movementSystem: System = (world) => {
  // Entities the path pass moved this tick. A path can complete (PathFollow removed) within the
  // pass, so membership can't be re-derived in pass 2 by checking has(PathFollow); record it here.
  // Used only as a skip filter — never iterated for a decision — so it stays determinism-safe.
  const pathHandled = new Set<Entity>();

  // Path followers first — deterministic insertion-order iteration of the PathFollow store, and a
  // path-driven entity's Velocity (if any) is ignored so it never moves twice in a tick.
  for (const e of world.query(Position, PathFollow)) {
    pathHandled.add(e);
    const pf = world.get(e, PathFollow);
    const target = pf.waypoints[pf.index];
    if (target === undefined) {
      // Empty/exhausted path — nothing to follow; drop it so the entity reads as arrived.
      world.remove(e, PathFollow);
      continue;
    }

    // A FLEEING unit runs (the faster run gait — {@link runGait}); otherwise it walks at its own pace when
    // it carries a MoveSpeed (a data-paced animal), else the universal settler default.
    const speed = world.has(e, Fleeing)
      ? runGait(world, e)
      : world.has(e, MoveSpeed)
        ? world.get(e, MoveSpeed).perTick
        : MOVE_SPEED_PER_TICK;
    const p = world.get(e, Position);
    if (stepTowardPoint(p, target, speed)) {
      // Arrived at this waypoint; advance to the next, or finish the path.
      if (pf.index + 1 >= pf.waypoints.length) {
        world.remove(e, PathFollow); // path complete
      } else {
        pf.index += 1;
      }
    }
  }

  // Free constant-velocity movers (entities the path pass did not handle this tick). Checking the
  // recorded set (not has(PathFollow)) means an entity whose path just completed isn't ALSO velocity-
  // integrated in the same tick — the "path overrides Velocity" contract holds on the arrival tick too.
  for (const e of world.query(Position, Velocity)) {
    if (pathHandled.has(e)) continue; // path-driven this tick: already moved above
    const p = world.get(e, Position);
    const v = world.get(e, Velocity);
    p.x = fx.add(p.x, v.x);
    p.y = fx.add(p.y, v.y);
  }
};

/**
 * Advance `p` STRAIGHT toward `target` by at most `speed` along the line between them, snapping onto
 * `target` (and returning `true`) once within one step — the arrival signal the caller advances the
 * path on. Stepping the unit vector × `speed` (not each axis independently) makes a DIAGONAL leg cover
 * the same tiles/tick as an axis leg: the old per-axis clamp moved `speed` on BOTH axes at once, so a
 * diagonal ran √2 fast (docs/FIDELITY.md "Movement / facing granularity"). Mirrors the projectile
 * advance's fixed-point isqrt homing.
 *
 * At the DEFAULT settler pace (`ONE/8` = 2^13) an AXIS leg is byte-identical to the old per-axis clamp:
 * the unit vector is ±1 on one axis and 0 on the other, positions stay multiples of 2^13 (so `dist`
 * equals `|delta|` exactly) and the per-axis step is exactly `speed` — which is why no default-speed
 * golden moved (only diagonal legs changed). A data-pinned animal pace whose step isn't a multiple of
 * 2^8 can round `dist` by ±1 (still fully deterministic run-to-run, just not identical to the old
 * clamp), but no golden exercises animal cardinal path-following. Pure fixed-point (isqrt + one div per
 * axis) — no floats, so identical inputs yield identical state.
 */
function stepTowardPoint(p: { x: Fixed; y: Fixed }, target: { x: Fixed; y: Fixed }, speed: Fixed): boolean {
  const dx = fx.sub(target.x, p.x);
  const dy = fx.sub(target.y, p.y);
  const dist = fx.isqrt(fx.add(fx.mul(dx, dx), fx.mul(dy, dy)));
  if (dist <= speed) {
    // Within one step (incl. already on it): snap exactly onto the waypoint so no drift accumulates
    // across legs, and signal arrival.
    p.x = target.x;
    p.y = target.y;
    return true;
  }
  // Advance the unit vector × speed. `dist > speed > 0` here, so each division is safe.
  p.x = fx.add(p.x, fx.div(fx.mul(dx, speed), dist));
  p.y = fx.add(p.y, fx.div(fx.mul(dy, speed), dist));
  return false;
}
