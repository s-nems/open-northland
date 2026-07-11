import { Health, Position, Projectile } from '../../components/index.js';
import { eventAt } from '../../core/events.js';
import { type Fixed, fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { applyPendingStaggers, type PendingStagger, resolveCombatHit } from '../agents/atomic.js';
import type { System, SystemContext } from '../context.js';
import { canonicalById } from '../spatial.js';

/**
 * How many tiles a projectile advances **per tick per unit** of the weapon's extracted `WeaponType.speed`
 * — the mapping of the unreadable `speed` unit onto the sim's tile/tick grid. A bow's `speed 8` × this =
 * **2 tiles/tick** (≈16× a settler's ⅛-tile walk, so an arrow visibly outruns and homes onto its target
 * over a few ticks rather than teleporting); a catapult's `speed 3` × this = ¾ tile/tick (a slower, heavier
 * shot). A ¼-tile-per-unit step keeps every real `speed` (3..8) landing on an integer fraction of ONE, so
 * no rounding drift enters — two runs stay byte-identical.
 *
 * APPROXIMATED / calibration-pending (source basis "Combat ranged projectiles"): the source carries `speed`'s
 * VALUE (faithful — captured verbatim) but NOT its unit, so this scale is a named calibration constant a
 * step-10 observation pins, not a data param. Isolating it here keeps the {@link Projectile} component the
 * faithful data and this one line the approximation.
 */
export const PROJECTILE_TILES_PER_SPEED_UNIT: Fixed = fx.div(fx.fromInt(1), fx.fromInt(4)); // ¼ tile/tick per speed unit

/**
 * ProjectileSystem — advance every in-flight {@link Projectile} one tick: home it on its target's CURRENT
 * position, and either LAND its blow on contact or EXPIRE it if the target is gone. The flight half of
 * ranged combat (the launch is the AtomicSystem's `attack` effect at the shooter's release frame; the hit
 * runs step 1's {@link resolveCombatHit}, shared with melee).
 *
 * Per projectile (visited in canonical ascending-id order so a stagger tie-break is order-independent):
 *  1. **target gone / dead / unpositioned** → the projectile EXPIRES at its last position: it is destroyed
 *     with no hit (no re-target — the original's homing-vs-ballistic + always-hit behaviour is unreadable,
 *     so this approximates a homing shot that simply drops when its mark falls; source basis);
 *  2. **within one step of the target** → it ARRIVES: land {@link resolveCombatHit} (the same material-column
 *     damage a melee swing deals — resolved on contact), announce `projectileHit`, and destroy it;
 *  3. **still short** → advance straight toward the target by one {@link projectileStep}, re-aiming next tick
 *     (homing). The step is >> a walking unit's, so it converges.
 *
 * Perf (golden rule 7): cost scales with the count of ACTIVE projectiles, not entities² — a projectile is a
 * bare entity no other system scans, and a spent one is destroyed the instant it hits/expires (no lingering
 * corpses). A tick with none in flight does a single empty `query` pass. Determinism: fixed-point straight-
 * line homing (isqrt + a per-axis unit step), canonical visit order, staggers deferred past the loop
 * ({@link applyPendingStaggers}); no RNG, no wall-clock. Inert on the goldens (they launch no ranged shot).
 */
export const projectileSystem: System = (world, ctx) => {
  // Deferred flinches from any lethal-miss survivor a projectile struck this tick — applied after the loop,
  // like the melee pass, so a stagger added mid-loop can't perturb a later projectile's hit decision.
  const pendingStaggers: PendingStagger[] = [];
  for (const p of canonicalById(world.query(Projectile, Position))) {
    advanceProjectile(world, ctx, p, pendingStaggers);
  }
  applyPendingStaggers(world, pendingStaggers);
};

/** Advance one projectile: expire on a lost target, land the blow on arrival, else home one step closer. */
function advanceProjectile(
  world: World,
  ctx: SystemContext,
  p: Entity,
  pendingStaggers: PendingStagger[],
): void {
  const proj = world.get(p, Projectile);
  const targetHealth = world.tryGet(proj.target, Health);
  const targetPos = world.tryGet(proj.target, Position);
  // Target gone / already dead / unpositioned → the shot has nothing to land on: expire it in place (no
  // re-target). A 0-HP-but-not-yet-reaped target counts as gone — cleanupSystem removes it this tick anyway.
  if (targetHealth === undefined || targetHealth.hitpoints <= 0 || targetPos === undefined) {
    world.destroy(p);
    return;
  }

  const pos = world.get(p, Position);
  const dx = fx.sub(targetPos.x, pos.x);
  const dy = fx.sub(targetPos.y, pos.y);
  const dist = fx.isqrt(fx.add(fx.mul(dx, dx), fx.mul(dy, dy)));
  const step = projectileStep(proj.speed);

  if (dist <= step) {
    // Arrived (this tick's step reaches / overshoots the target): land the blow with step 1's damage model
    // on contact, announce the impact, and destroy the spent projectile.
    resolveCombatHit(
      world,
      ctx,
      proj.source,
      proj.target,
      proj.damage,
      proj.weaponMainType ?? undefined,
      pendingStaggers,
      'projectile', // ranged: the projectile announces its own `projectileHit`, not a melee `combatHit`
    );
    ctx.events.emit({
      kind: 'projectileHit',
      projectile: p,
      shooter: proj.source,
      target: proj.target,
      munitionType: proj.munitionType,
      at: eventAt(targetPos.x, targetPos.y),
    });
    world.destroy(p);
    return;
  }

  // Still in flight: step straight toward the target's current position (homing). `dist > step > 0` here,
  // so the unit-vector division is safe (the `dist === 0` case is caught by the arrival branch above).
  const ux = fx.div(dx, dist);
  const uy = fx.div(dy, dist);
  pos.x = fx.add(pos.x, fx.mul(ux, step));
  pos.y = fx.add(pos.y, fx.mul(uy, step));
}

/** The per-tick tile step a projectile of extracted `speed` advances — `speed × {@link
 *  PROJECTILE_TILES_PER_SPEED_UNIT}` in fixed-point. A positive `speed` (the launch gate guarantees it)
 *  yields a positive step, so a projectile always closes on its target. */
function projectileStep(speed: number): Fixed {
  return fx.mul(fx.fromInt(speed), PROJECTILE_TILES_PER_SPEED_UNIT);
}
