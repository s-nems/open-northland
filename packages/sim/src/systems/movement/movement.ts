import { Fleeing, MoveSpeed, PathFollow, Position, Velocity } from '../../components/index.js';
import { type Fixed, fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { worldDistance } from '../../nav/metric.js';
import type { System } from '../context.js';

/**
 * How far an entity following a {@link PathFollow} advances per tick, in WORLD-METRIC units
 * (`nav/metric.ts`: one unit = one full 68 px cell width). At this pace an E/W leg (one column)
 * takes eight ticks and a row-crossing lattice leg (¾ the world length) takes six — the on-screen
 * pace is the same either way, by construction. A divisor of ONE keeps an E/W step landing exactly
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
 *     along the LINE to the waypoint with the step length measured in the staggered lattice's WORLD
 *     metric — so every heading covers the same on-screen distance per tick ({@link stepTowardPoint}).
 *     On reaching the waypoint, advance `index`; when the last waypoint is reached the path is
 *     complete and {@link PathFollow} is removed (the planner sees an entity with no path as
 *     idle/arrived). A path-following entity ignores any Velocity.
 *  2. {@link Velocity} (no PathFollow): the original constant-velocity integration — kept for the
 *     determinism golden and any free-moving entity that isn't path-driven.
 *
 * Fixed-point only; the straight-line step (isqrt homing, mirroring the projectile advance) means no
 * floats and no overshoot — a pure function of position + waypoint, so identical inputs yield identical
 * state. An E/W leg is byte-identical to the old grid-space step; every other heading paces by the
 * world metric (the intentional change — see {@link stepTowardPoint}).
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
 * path on. The step length is measured in the WORLD METRIC of the staggered lattice
 * (`nav/metric.ts` {@link worldDistance}: a row step is half a column sideways + 19/34 down), so a
 * walk covers the same ON-SCREEN distance per tick in every direction — an E/W leg (a full 68 px
 * column) takes 8 ticks at the default pace, a row-crossing lattice leg (a 51 px edge, ¾ the length)
 * takes 6. Measuring in raw grid units instead made a north–south walk read ~25% slower than an
 * east–west one and a re-path leg lurch (the reported speed wobble; docs/FIDELITY.md "Movement on
 * the staggered lattice"). Mirrors the projectile advance's fixed-point isqrt homing.
 *
 * An E/W leg is byte-identical to the old grid-space step: both endpoints share a row, so the
 * stagger shift cancels and the world distance IS `|dx|` — which is why no pure-east golden moved.
 * Every other heading intentionally changed (that is the fix). The per-tick advance divides the grid
 * delta by the world distance — truncation can shave an ulp, but the arrival snap absorbs it (no
 * drift accumulates across legs) and the maths is pure fixed-point, so identical inputs yield
 * identical state.
 */
function stepTowardPoint(p: { x: Fixed; y: Fixed }, target: { x: Fixed; y: Fixed }, speed: Fixed): boolean {
  const dx = fx.sub(target.x, p.x);
  const dy = fx.sub(target.y, p.y);
  const dist = worldDistance(p.x, p.y, target.x, target.y);
  if (dist <= speed) {
    // Within one step (incl. already on it): snap exactly onto the waypoint so no drift accumulates
    // across legs, and signal arrival.
    p.x = target.x;
    p.y = target.y;
    return true;
  }
  // Advance the grid delta scaled to one world-metric step. `dist > speed > 0` here, so each
  // division is safe.
  p.x = fx.add(p.x, fx.div(fx.mul(dx, speed), dist));
  p.y = fx.add(p.y, fx.div(fx.mul(dy, speed), dist));
  return false;
}
