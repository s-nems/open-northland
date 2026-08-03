import { MoveSpeed, PathFollow, Position, Velocity } from '../../components/index.js';
import { type Fixed, fx, ONE, ULP, ZERO } from '../../core/fixed.js';
import type { Entity } from '../../ecs/world.js';
import { worldDistance } from '../../nav/world-metric.js';
import type { System } from '../context.js';
import { bootsSpeedBonus, wearWornBoots } from '../equipment/index.js';
import { legHeading, stepTowardPoint, turnOntoNextLeg } from './stepping.js';

/**
 * How many ticks a full walking gait spends crossing one E/W cell (one 68 px column). Observation: a route
 * taking 21 s in the original took 14 s at 12 ticks per cell, so the duration is scaled by 1.5 to 18. The
 * renderer stretches the authored 12-frame walk cycle over the same distance, so the feet do not skate.
 */
export const WALK_TICKS_PER_CELL = 18;

/**
 * How far an entity following a {@link PathFollow} advances per tick at full walking gait, in world-metric
 * units where one unit is a full 68 px cell width.
 *
 * source-basis (approximated): no readable human `movespeed` exists (`animaltypes.ini` and the
 * `logicwalkspeed` animation field are animal-only), so the magnitude hangs on the walk-cycle anchor above.
 *
 * Minted with `divCeil`, not `div`: trunc(ONE/18) leaves a 16-ulp remainder, so every cell leg would cost a
 * 19th, nearly-stationary snap tick. Ceil makes a leg's last step slightly short instead, absorbed by the
 * arrival snap so no drift accumulates across legs.
 */
export const MOVE_SPEED_PER_TICK: Fixed = fx.divCeil(ONE, fx.fromInt(WALK_TICKS_PER_CELL));

/*
 * Movement inertia, a named approximation: the original moves a unit at a constant ticks-per-step pace, with
 * no observed acceleration and no acceleration parameter in readable data. The gait lives in sim state
 * ({@link PathFollow}.`speed`), so it stays deterministic and replay-exact.
 */

/**
 * Ticks from rest to full gait (0.25 s at 12 Hz): the ramp accelerates by `divCeil(gait / ACCEL_TICKS)` per
 * tick, where ceil keeps the step at 1 ulp or more for any gait and makes the ramp exactly this many ticks.
 * Also the recovery rate after a corner sheds speed.
 */
export const ACCEL_TICKS = 3;

/**
 * The final-approach brake horizon: on a path's last leg the target speed is capped at
 * `remaining / BRAKE_HORIZON_TICKS`, an exponential ease-out that begins about a sixth of a cell out at the
 * default gait.
 */
const BRAKE_HORIZON_TICKS = 2;

/**
 * The brake floor: the ease-out never drops below `gait / ARRIVAL_SPEED_DIV`, so the arrival snap
 * always closes in a few ticks (no Zeno crawl) and the touch-down still reads soft.
 */
export const ARRIVAL_SPEED_DIV = 2;

/**
 * Advances entity positions one tick. A {@link PathFollow} takes precedence over any {@link Velocity}: the
 * follower ramps its gait, steps toward the current waypoint, and drops the component at the last one, which
 * the planner reads as arrived. Everything else integrates its velocity.
 *
 * An E/W leg's step is bit-exact `speed`; every other heading paces by the staggered lattice's world metric,
 * so every heading covers the same on-screen distance per tick. The straight-line step uses isqrt homing, so
 * there are no floats and no overshoot. Approximation: no run gait is modeled, since no human run speed is
 * readable and the animal `runspeed` is deliberately unconsumed, so a fleeing unit walks at its one pace.
 */
export const movementSystem: System = (world, ctx) => {
  // Entities the path pass moved this tick: a path can complete within the pass, so the velocity pass
  // cannot re-derive membership from has(PathFollow). Read only as a skip filter, never iterated.
  const pathHandled = new Set<Entity>();

  for (const e of world.query(Position, PathFollow)) {
    pathHandled.add(e);
    const pf = world.get(e, PathFollow);
    const target = pf.waypoints[pf.index];
    if (target === undefined) {
      // Empty or exhausted path: drop it so the entity reads as arrived.
      world.remove(e, PathFollow);
      continue;
    }

    // Degenerate-pace guard: `ONE/movespeed` truncation can mint a perTick of 0 ulps, which never makes
    // progress, so the walker stalls and the path never completes. One ULP keeps such a pace terminating.
    const rawGait = world.has(e, MoveSpeed) ? world.get(e, MoveSpeed).perTick : MOVE_SPEED_PER_TICK;
    const floored = rawGait > ULP ? rawGait : ULP;
    // Worn boots raise the cruise gait by their content-rated fraction (the manual: "A Viking wearing
    // shoes can walk much faster"; the magnitude is an approximation). The > ZERO guard keeps every
    // bootless walker's arithmetic byte-identical.
    const bootBonus = bootsSpeedBonus(world, ctx, e);
    const gait = bootBonus > ZERO ? fx.mul(floored, fx.add(ONE, bootBonus)) : floored;
    const p = world.get(e, Position);

    // The tick's target speed: the cruise gait, capped on the last leg so the approach eases out.
    let targetSpeed = gait;
    if (pf.index + 1 >= pf.waypoints.length) {
      const remaining = worldDistance(p.x, p.y, target.x, target.y);
      const braked = fx.div(remaining, fx.fromInt(BRAKE_HORIZON_TICKS));
      const floor = fx.divCeil(gait, fx.fromInt(ARRIVAL_SPEED_DIV)); // ceil: ≥ 1 ulp for any gait
      const eased = braked > floor ? braked : floor;
      targetSpeed = eased < gait ? eased : gait;
    }

    // Accelerating is gradual, decelerating immediate: the ease-out's smoothness comes from the target
    // curve itself, and the clamp absorbs the ulp a truncated corner projection can add.
    if (pf.speed < targetSpeed) {
      const accelerated = fx.add(pf.speed, fx.divCeil(gait, fx.fromInt(ACCEL_TICKS)));
      pf.speed = accelerated < targetSpeed ? accelerated : targetSpeed;
    } else {
      pf.speed = targetSpeed;
    }

    // A fresh or rerouted path carries the (0, 0) heading sentinel: record this leg's before the first
    // step, so the first corner can project momentum across it.
    if (pf.hx === ZERO && pf.hy === ZERO) {
      const h = legHeading(p, target);
      if (h !== null) {
        pf.hx = h.x;
        pf.hy = h.y;
      }
    }

    if (stepTowardPoint(p, target, pf.speed)) {
      // Reaching a waypoint wears the walker's boots one step; the empty-path drop above is not a walk.
      wearWornBoots(world, ctx, e);
      if (pf.index + 1 >= pf.waypoints.length) {
        world.remove(e, PathFollow);
      } else {
        pf.index += 1;
        turnOntoNextLeg(pf, p);
      }
    }
  }

  // Reading the recorded set rather than has(PathFollow) keeps an entity whose path just completed from
  // also being velocity-integrated on its arrival tick.
  for (const e of world.query(Position, Velocity)) {
    if (pathHandled.has(e)) continue;
    const p = world.get(e, Position);
    const v = world.get(e, Velocity);
    p.x = fx.add(p.x, v.x);
    p.y = fx.add(p.y, v.y);
  }
};
