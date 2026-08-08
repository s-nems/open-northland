import { MoveSpeed, PathFollow, Position, Velocity } from '../../components/index.js';
import { type Fixed, fx, ONE, ULP, ZERO } from '../../core/fixed.js';
import type { Entity } from '../../ecs/world.js';
import { worldDistance } from '../../nav/world-metric.js';
import type { System } from '../context.js';
import { bootsSpeedBonus, wearWornBoots } from '../equipment/index.js';
import { legHeading, stepTowardPoint, turnOntoNextLeg } from './stepping.js';

/**
 * How many ticks a full walking gait spends crossing one E/W cell, one 68 px column. Observation: a route
 * taking 21 s in the original took 14 s at 12 ticks per cell, so the duration is scaled by 1.5 to 18.
 */
export const WALK_TICKS_PER_CELL = 18;

/**
 * How far a path follower advances per tick at full walking gait, in world-metric units where one unit is a
 * full 68 px cell width. Approximation: no readable human `movespeed` exists (`animaltypes.ini` and the
 * `logicwalkspeed` animation field are animal-only), so the magnitude hangs on the walk-cycle anchor above.
 * Minted with `divCeil` so the truncated remainder cannot cost every cell leg a 19th, nearly-stationary tick.
 */
export const MOVE_SPEED_PER_TICK: Fixed = fx.divCeil(ONE, fx.fromInt(WALK_TICKS_PER_CELL));

/** Ticks from rest to full gait, and the recovery rate after a corner sheds speed. Authored: no
 *  acceleration parameter is readable in the source data. */
export const ACCEL_TICKS = 3;

/** The final-approach brake horizon: a path's last leg caps target speed at `remaining / this`. */
const BRAKE_HORIZON_TICKS = 2;

/**
 * The brake floor: the ease-out never drops below `gait / ARRIVAL_SPEED_DIV`, so arrival closes in a few
 * ticks instead of a Zeno crawl.
 */
export const ARRIVAL_SPEED_DIV = 2;

/**
 * Advances entity positions one tick. A {@link PathFollow} takes precedence over any {@link Velocity}, and
 * dropping it at the last waypoint is what the planner reads as arrived.
 */
export const movementSystem: System = (world, ctx) => {
  // A path can complete within this pass, so the velocity pass below cannot re-derive membership from
  // has(PathFollow) and must read the recorded set instead.
  const pathHandled = new Set<Entity>();

  for (const e of world.query(Position, PathFollow)) {
    pathHandled.add(e);
    const pf = world.mut(e, PathFollow);
    const target = pf.waypoints[pf.index];
    if (target === undefined) {
      world.remove(e, PathFollow);
      continue;
    }

    // A content pace can truncate to 0 ulps, which never makes progress; one ULP keeps such a pace
    // terminating.
    const rawGait = world.has(e, MoveSpeed) ? world.get(e, MoveSpeed).perTick : MOVE_SPEED_PER_TICK;
    const floored = rawGait > ULP ? rawGait : ULP;
    // Worn boots raise the cruise gait by their content-rated fraction (the manual: "A Viking wearing shoes
    // can walk much faster"; the magnitude is an approximation). The > ZERO guard keeps every bootless
    // walker's arithmetic byte-identical.
    const bootBonus = bootsSpeedBonus(world, ctx, e);
    const gait = bootBonus > ZERO ? fx.mul(floored, fx.add(ONE, bootBonus)) : floored;
    const p = world.mut(e, Position);

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

    // A fresh or rerouted path carries the (0, 0) heading sentinel; recording this leg's heading before the
    // first step lets the first corner project momentum across it.
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

  for (const e of world.query(Position, Velocity)) {
    if (pathHandled.has(e)) continue;
    const p = world.mut(e, Position);
    const v = world.get(e, Velocity);
    p.x = fx.add(p.x, v.x);
    p.y = fx.add(p.y, v.y);
  }
};
