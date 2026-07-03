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
 * calibration constant — the original's run-vs-walk ratio is unreadable; docs/FIDELITY.md "Combat stance —
 * FLEE"). An integer multiple of the ⅛-tile walk keeps the run step dividing ONE evenly, so no rounding
 * drift enters — two runs stay byte-identical.
 */
export const RUN_SPEED_MULTIPLIER = 2;

/**
 * A fleeing unit's per-tick **run** gait: its own {@link MoveSpeed} `runPerTick` when it has one (the first
 * consumer of the extracted animal `runspeed` — a fleeing creature runs at its data-pinned run pace), else
 * its walk pace ({@link MoveSpeed} `perTick`, or the universal {@link MOVE_SPEED_PER_TICK}) × the
 * {@link RUN_SPEED_MULTIPLIER} (a human's approximated run speed). Pure fixed-point — a deterministic read.
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
 *  1. {@link PathFollow}: step toward the current waypoint's cell centre by the entity's own pace
 *     ({@link MoveSpeed}'s `perTick` if it carries one, else the universal {@link MOVE_SPEED_PER_TICK}),
 *     per-axis clamped so we never overshoot. On reaching the waypoint, advance `index`; when the
 *     last waypoint is reached the path is complete and {@link PathFollow} is removed (the planner
 *     sees an entity with no path as idle/arrived). A path-following entity ignores any Velocity.
 *  2. {@link Velocity} (no PathFollow): the original constant-velocity integration — kept for the
 *     determinism golden and any free-moving entity that isn't path-driven.
 *
 * Fixed-point only; per-axis clamp-toward means no floats, no sqrt/normalisation, no overshoot —
 * the step is a pure function of position + waypoint, so identical inputs yield identical state.
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
    p.x = stepToward(p.x, target.x, speed);
    p.y = stepToward(p.y, target.y, speed);

    if (p.x === target.x && p.y === target.y) {
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
 * Move `from` toward `target` by at most `speed` (the entity's per-tick pace), clamping so the result
 * never passes `target`. Returns `target` exactly once within one step of it — the equality the caller
 * uses to detect arrival. Pure fixed-point: no division of the delta, so no rounding drift.
 */
function stepToward(from: Fixed, target: Fixed, speed: Fixed): Fixed {
  const delta = fx.sub(target, from);
  if (delta === 0) return target;
  const dist = fx.abs(delta);
  if (dist <= speed) return target; // within one step — snap to the target
  return delta > 0 ? fx.add(from, speed) : fx.sub(from, speed);
}
