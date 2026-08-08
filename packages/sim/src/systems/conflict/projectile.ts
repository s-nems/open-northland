import { Building, Health, Position, Projectile } from '../../components/index.js';
import { eventAt } from '../../core/events.js';
import { type Fixed, fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import {
  applyPendingStaggers,
  type PendingStagger,
  resolveCombatHit,
} from '../settlers/atomics/effects/combat/index.js';
import { canonicalById } from '../spatial/nodes.js';

/**
 * How many tiles a projectile advances per tick per unit of the weapon's extracted `WeaponType.speed` - the
 * mapping of the unreadable `speed` unit onto the sim's tile/tick grid. A bow's `speed 8` gives 1 tile/tick,
 * 18x a settler's walk; a catapult's `speed 3` gives ⅜ tile/tick. An ⅛-tile-per-unit step keeps every real
 * `speed` (3..8) on an integer fraction of ONE, so no rounding drift enters and two runs stay byte-identical.
 * Tiles here are raw grid units, which makes this the east-west pace: {@link flightStep} does not weight a
 * row step, and one draws 38 px against a column's 68.
 *
 * Approximated, calibration-pending (source basis "Combat ranged projectiles"): the source carries `speed`'s
 * value verbatim but not its unit, so this scale is tuned by eye against the drawn flight, not a data param.
 */
export const PROJECTILE_TILES_PER_SPEED_UNIT: Fixed = fx.div(fx.fromInt(1), fx.fromInt(8)); // ⅛ tile/tick per speed unit

/**
 * ProjectileSystem - advance every in-flight {@link Projectile} one tick: home it on its target's current
 * position, and either land its blow on contact or bring it down in the dirt once the target is gone. The
 * launch is the AtomicSystem's `attack` effect at the shooter's release frame; the hit runs the same
 * {@link resolveCombatHit} a melee swing does.
 *
 * Projectiles are visited in canonical ascending-id order and staggers are deferred past the loop, so a
 * stagger tie-break is order-independent. Cost scales with the count of active projectiles: nothing else
 * scans them, and a spent one is destroyed the instant it lands.
 */
export const projectileSystem: System = (world, ctx) => {
  // Deferred flinches from any lethal-miss survivor struck this tick, so a stagger added mid-loop cannot
  // perturb a later projectile's hit decision.
  const pendingStaggers: PendingStagger[] = [];
  for (const p of canonicalById(world.query(Projectile, Position))) {
    advanceProjectile(world, ctx, p, pendingStaggers);
  }
  applyPendingStaggers(world, pendingStaggers);
};

/** Advance one projectile: a true shot homes on its live mark and lands its blow on arrival; one with no
 *  live mark left flies its frozen aim ({@link freezeAim}) into the dirt. */
function advanceProjectile(
  world: World,
  ctx: SystemContext,
  p: Entity,
  pendingStaggers: PendingStagger[],
): void {
  const proj = world.get(p, Projectile);
  // Loosed this tick: it does not move, so a shot is observable at its launch point (approximated - the
  // sub-tick release instant is unreadable). It still settles its aim below, because the cleanupSystem reaps
  // a mark that fell this tick and a shot that waited would find nowhere to come down.
  const restsAtBow = proj.launchTick === ctx.tick;
  const targetPos = proj.missAim === null ? liveMark(world, proj.target) : null;
  if (targetPos === null) {
    const aim = proj.missAim ?? freezeAim(world, p, proj.target);
    if (aim === null) return; // nothing left to aim at - the shot was destroyed
    if (!restsAtBow) flyToDirt(world, ctx, p, proj, aim);
    return;
  }
  if (restsAtBow) return;

  if (flightStep(world, p, targetPos.x, targetPos.y, proj.speed)) {
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
      ...(world.has(proj.target, Building) ? { structure: true } : {}),
    });
    world.destroy(p);
  }
}

/** The position a true shot still homes on - its target's, while that target is alive and positioned;
 *  null once it has fallen (0 hitpoints, reaped by the cleanupSystem this tick) or lost its Position. */
function liveMark(world: World, target: Entity): { x: Fixed; y: Fixed } | null {
  const health = world.tryGet(target, Health);
  if (health === undefined || health.hitpoints <= 0) return null;
  return world.tryGet(target, Position) ?? null;
}

/** Fly a shot whose aim is frozen one step toward it, landing it in the dirt (`projectileMissed`, no blow)
 *  on arrival. Shared by a release-time miss and a stranded shot - the two flights are the same. */
function flyToDirt(
  world: World,
  ctx: SystemContext,
  p: Entity,
  proj: { source: Entity; munitionType: number; speed: number },
  aim: { x: Fixed; y: Fixed },
): void {
  if (!flightStep(world, p, aim.x, aim.y, proj.speed)) return;
  ctx.events.emit({
    kind: 'projectileMissed',
    projectile: p,
    shooter: proj.source,
    munitionType: proj.munitionType,
    at: eventAt(aim.x, aim.y),
  });
  world.destroy(p);
}

/** Freeze a stranded shot's aim on the spot its fallen mark last stood, and return it: the shot flies on and
 *  lands there dealing nothing. No re-target - the original's homing-vs-ballistic behaviour is unreadable
 *  (source basis), so picking a new victim after release would be a different mechanic. */
function freezeAim(world: World, p: Entity, target: Entity): { x: Fixed; y: Fixed } | null {
  const last = world.tryGet(target, Position);
  if (last === undefined) {
    world.destroy(p);
    return null;
  }
  const aim = { x: last.x, y: last.y };
  world.mut(p, Projectile).missAim = aim;
  return aim;
}

/** Step projectile `p` one tick straight toward `(ax, ay)`; true when this tick's step reaches it. The
 *  in-flight unit-vector division is safe: `dist > step > 0` on the stepping branch. */
function flightStep(world: World, p: Entity, ax: Fixed, ay: Fixed, speed: number): boolean {
  const pos = world.mut(p, Position);
  const dx = fx.sub(ax, pos.x);
  const dy = fx.sub(ay, pos.y);
  const dist = fx.isqrt(fx.add(fx.mul(dx, dx), fx.mul(dy, dy)));
  const step = projectileStep(speed);
  if (dist <= step) return true;
  const ux = fx.div(dx, dist);
  const uy = fx.div(dy, dist);
  pos.x = fx.add(pos.x, fx.mul(ux, step));
  pos.y = fx.add(pos.y, fx.mul(uy, step));
  return false;
}

/** The per-tick tile step a projectile of extracted `speed` advances. The launch gate guarantees a positive
 *  `speed`, so the step is positive and a projectile always closes on its target. */
function projectileStep(speed: number): Fixed {
  return fx.mul(fx.fromInt(speed), PROJECTILE_TILES_PER_SPEED_UNIT);
}
