import { MoveSpeed, PathFollow, Position, Velocity } from '../../components/index.js';
import { type Fixed, fx, ONE, ULP, ZERO } from '../../core/fixed.js';
import type { Entity } from '../../ecs/world.js';
import { worldDistance } from '../../nav/metric.js';
import type { System } from '../context.js';
import { legHeading, stepTowardPoint, turnOntoNextLeg } from './stepping.js';

/**
 * How many ticks a full walking gait spends crossing one E/W cell (one 68 px column). Pinned to the
 * one data anchor the original leaves readable: the human walk atomic is exactly **12 frames per
 * direction** (`mapmoveableanimations/animations.ini`) and the render advances a looping gait one
 * frame per sim tick — so at 12 ticks per cell one FULL walk cycle closes exactly as one cell
 * closes and the feet never skate. 0.6 s per cell at 20 Hz.
 */
export const WALK_TICKS_PER_CELL = 12;

/**
 * How far an entity following a {@link PathFollow} advances per tick at FULL WALKING GAIT, in
 * WORLD-METRIC units (`nav/metric.ts`: one unit = one full 68 px cell width) — the cruise pace the
 * inertia ramp accelerates toward ({@link ACCEL_TICKS}). An E/W leg (one column) takes
 * {@link WALK_TICKS_PER_CELL} ticks and a row-crossing lattice leg (¾ the world length) takes nine —
 * the on-screen pace is the same either way, by construction.
 *
 * Source basis "Movement step speed": no readable human `movespeed` exists (`animaltypes.ini` and
 * the `logicwalkspeed` animation field are animal-only; the human default is compiled into the
 * original binary, unreconstructed by OpenVikings), so the magnitude hangs on the walk-cycle anchor
 * above — which also matches the original's unhurried walk far better than the earlier ⅛ read (a
 * pure calibration-by-observation, still visibly too brisk).
 *
 * Minted with `divCeil`, NOT `div`: trunc(ONE/12) leaves a 4-ulp remainder, so every cell leg would
 * cost a 13th, nearly-stationary snap tick — a visible per-cell hitch. Ceil makes a leg's LAST step
 * slightly short instead (absorbed by the arrival snap, so no drift accumulates across legs).
 */
export const MOVE_SPEED_PER_TICK: Fixed = fx.divCeil(ONE, fx.fromInt(WALK_TICKS_PER_CELL));

/*
 * MOVEMENT INERTIA — the three constants below shape it. A NAMED APPROXIMATION that deliberately
 * departs from the original: the original engine moves a unit at a constant ticks-per-step pace
 * with no acceleration anywhere (no accel/inertia state exists in OpenVikings or any readable data
 * — source basis "Movement step speed"). OpenNorthland adds a light ease-in/out for movement FEEL: a
 * unit ramps up from rest, sheds speed through corners (momentum projected onto the new heading),
 * and brakes over the final approach instead of stopping dead. The gait lives in sim state
 * ({@link PathFollow}.`speed`), so it is deterministic and replay-exact; the render keeps
 * interpolating positions exactly as before. All three are feel-tuning knobs.
 */

/**
 * Ticks from rest to full gait (0.15 s at 20 Hz): the ramp accelerates by `divCeil(gait /
 * ACCEL_TICKS)` per tick (ceil keeps the step ≥ 1 ulp for any gait AND makes the ramp exactly this
 * many ticks). Also the recovery rate after a corner sheds speed. Deliberately SHORT — the inertia
 * should read as body weight, not sluggishness (feel-tuned: the first 4-tick cut was visibly too
 * heavy).
 */
export const ACCEL_TICKS = 3;

/**
 * The final-approach brake horizon: on a path's LAST leg the target speed is capped at
 * `remaining / BRAKE_HORIZON_TICKS`, an exponential ease-out (the remaining distance roughly
 * halves per tick) that begins about a sixth of a cell out at the default gait — a soft touch-down
 * of a couple of ticks, not a long glide (feel-tuned alongside {@link ACCEL_TICKS}).
 */
export const BRAKE_HORIZON_TICKS = 2;

/**
 * The brake floor: the ease-out never drops below `gait / ARRIVAL_SPEED_DIV`, so the arrival snap
 * always closes in a few ticks (no Zeno crawl) and the touch-down still reads soft.
 */
export const ARRIVAL_SPEED_DIV = 2;

/**
 * MovementSystem — advances entity positions one tick.
 *
 * Two movement modes, in this precedence:
 *  1. {@link PathFollow}: ramp the follower's gait `speed` toward its cruise pace ({@link MoveSpeed}'s
 *     `perTick` if it carries one, else the universal {@link MOVE_SPEED_PER_TICK}; the gait is the
 *     SAME whatever the entity is doing — the original has no sprint, a fleeing unit walks at its
 *     one pace) — accelerating from rest by {@link ACCEL_TICKS}, braking over the last leg's final
 *     approach ({@link BRAKE_HORIZON_TICKS}/{@link ARRIVAL_SPEED_DIV}) — then step STRAIGHT toward
 *     the current waypoint (a cell centre, or the seam point a vertical leg crosses the intermediate
 *     row at — `routing.ts`) by that speed, along the LINE to the waypoint with the step length
 *     measured in the staggered lattice's WORLD metric — so every heading covers the same on-screen
 *     distance per tick ({@link stepTowardPoint}).
 *     On reaching the waypoint, advance `index` and project the momentum onto the next leg's heading
 *     ({@link turnOntoNextLeg}: straight through costs nothing, a corner sheds speed); when the last
 *     waypoint is reached the path is complete and {@link PathFollow} is removed (the planner sees an
 *     entity with no path as idle/arrived). A path-following entity ignores any Velocity.
 *  2. {@link Velocity} (no PathFollow): the original constant-velocity integration — kept for the
 *     determinism golden and any free-moving entity that isn't path-driven.
 *
 * Fixed-point only; the straight-line step (isqrt homing, mirroring the projectile advance) means no
 * floats and no overshoot — a pure function of position + waypoint, so identical inputs yield identical
 * state. An E/W leg's step is bit-exact `speed`; every other heading paces by the world metric
 * (see {@link stepTowardPoint}).
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

    // The entity's ONE pace: its own MoveSpeed when it carries one (a data-paced animal), else the
    // universal settler default. Deliberately unconditional — no run/sprint mode exists (the
    // original moves every unit at its constant pace; a fleeing unit escapes by pathing away, not
    // by speeding up).
    //
    // Degenerate-pace guard: `ONE/movespeed` truncation can mint a perTick as small as 0 ulps — a
    // 0-ulp gait makes no progress EVER, so the walker would stall and the path never complete
    // (the planner would see it as busy forever). Floor the gait at one ULP (the derived accel
    // step and brake floor stay ≥ 1 by their ceil mints below): an absurdly slow data-pinned pace
    // stays absurdly slow, but the sim stays total (every path still terminates).
    const rawGait = world.has(e, MoveSpeed) ? world.get(e, MoveSpeed).perTick : MOVE_SPEED_PER_TICK;
    const gait = rawGait > ULP ? rawGait : ULP;
    const p = world.get(e, Position);

    // The tick's TARGET speed: the cruise gait, capped on the last leg's final approach so the
    // walk eases out — the target itself shrinks with the remaining distance (~⅔ decay per tick),
    // floored so the arrival snap always closes.
    let targetSpeed = gait;
    if (pf.index + 1 >= pf.waypoints.length) {
      const remaining = worldDistance(p.x, p.y, target.x, target.y);
      const braked = fx.div(remaining, fx.fromInt(BRAKE_HORIZON_TICKS));
      const floor = fx.divCeil(gait, fx.fromInt(ARRIVAL_SPEED_DIV)); // ceil: ≥ 1 ulp for any gait
      const eased = braked > floor ? braked : floor;
      targetSpeed = eased < gait ? eased : gait;
    }

    // Ramp the gait: accelerate toward the target by gait/ACCEL_TICKS per tick; when ABOVE the
    // target (the shrinking brake cap) clamp down at once — the
    // ease-out's smoothness comes from the target curve itself, and the clamp also absorbs the
    // ulp of inflation a truncated corner projection can carry.
    if (pf.speed < targetSpeed) {
      // Ceil: the step stays ≥ 1 ulp for any gait AND a from-rest ramp is exactly ACCEL_TICKS long.
      const accelerated = fx.add(pf.speed, fx.divCeil(gait, fx.fromInt(ACCEL_TICKS)));
      pf.speed = accelerated < targetSpeed ? accelerated : targetSpeed;
    } else {
      pf.speed = targetSpeed;
    }

    // A fresh/rerouted path has no established heading yet (the (0,0) sentinel): record this leg's
    // before the first step, so the first real corner can project momentum across it.
    if (pf.hx === ZERO && pf.hy === ZERO) {
      const h = legHeading(p, target);
      if (h !== null) {
        pf.hx = h.x;
        pf.hy = h.y;
      }
    }

    if (stepTowardPoint(p, target, pf.speed)) {
      // Arrived at this waypoint; advance to the next (turning momentum onto it), or finish.
      if (pf.index + 1 >= pf.waypoints.length) {
        world.remove(e, PathFollow); // path complete
      } else {
        pf.index += 1;
        turnOntoNextLeg(pf, p);
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
