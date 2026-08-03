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
 * How many tiles a projectile advances **per tick per unit** of the weapon's extracted `WeaponType.speed`
 * - the mapping of the unreadable `speed` unit onto the sim's tile/tick grid. A bow's `speed 8` × this =
 * **1 tile/tick**, 18× a settler's `MOVE_SPEED_PER_TICK` walk, so an arrow visibly outruns and homes onto
 * its target over several ticks rather than teleporting; a catapult's `speed 3` gives ⅜ tile/tick. An
 * ⅛-tile-per-unit step keeps every real `speed` (3..8) on an integer fraction of ONE, so no rounding drift
 * enters and two runs stay byte-identical. Tiles here are raw grid units, which makes this the EAST-WEST
 * pace: {@link flightStep} does not weight a row step, and one draws 38 px against a column's 68
 * (`docs/tickets/sim/projectile-flight-screen-metric.md`).
 *
 * APPROXIMATED / calibration-pending (source basis "Combat ranged projectiles"): the source carries `speed`'s
 * VALUE (faithful - captured verbatim) but NOT its unit, so this scale is a named calibration constant tuned
 * by eye against the drawn flight, not a data param (`docs/tickets/features/combat-calibration.md`).
 * Isolating it here keeps the {@link Projectile} component the faithful data and this one line the
 * approximation.
 */
export const PROJECTILE_TILES_PER_SPEED_UNIT: Fixed = fx.div(fx.fromInt(1), fx.fromInt(8)); // ⅛ tile/tick per speed unit

/**
 * ProjectileSystem - advance every in-flight {@link Projectile} one tick: home it on its target's CURRENT
 * position, and either LAND its blow on contact or bring it down in the dirt if the target is gone. The
 * flight half of ranged combat (the launch is the AtomicSystem's `attack` effect at the shooter's release
 * frame; the hit runs step 1's {@link resolveCombatHit}, shared with melee).
 *
 * Per projectile (visited in canonical ascending-id order so a stagger tie-break is order-independent):
 *  0. **loosed this tick** → it rests at the bow, so its first observable position is the shooter's cell;
 *  1. **aim frozen** (`missAim` set - missed at release, or stranded by 2) → it flies to that point and
 *     lands in the dirt: `projectileMissed`, no blow;
 *  2. **target dead / unpositioned mid-flight** → the shot is STRANDED ({@link freezeAim}): its aim
 *     freezes where the mark last stood and it lands there dealing nothing;
 *  3. **within one step of the target** → it ARRIVES: land {@link resolveCombatHit} (the same material-column
 *     damage a melee swing deals - resolved on contact), announce `projectileHit`, and destroy it;
 *  4. **still short** → advance straight toward the target by one {@link projectileStep}, re-aiming next tick
 *     (homing). The step is >> a walking unit's, so it converges.
 *
 * Perf (golden rule 7): cost scales with the count of ACTIVE projectiles, not entities² - a projectile is a
 * bare entity no other system scans, and a spent one is destroyed the instant it lands (no lingering
 * corpses). A tick with none in flight does a single empty `query` pass. Determinism: fixed-point straight-
 * line homing (isqrt + a per-axis unit step), canonical visit order, staggers deferred past the loop
 * ({@link applyPendingStaggers}); no RNG, no wall-clock. Inert on the goldens (they launch no ranged shot).
 */
export const projectileSystem: System = (world, ctx) => {
  // Deferred flinches from any lethal-miss survivor a projectile struck this tick - applied after the loop,
  // like the melee pass, so a stagger added mid-loop can't perturb a later projectile's hit decision.
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
  // Loosed this tick: it does not move, so a shot is observable at its launch point - approximated, the
  // sub-tick release instant is unreadable. It still SETTLES ITS AIM below, because the cleanupSystem reaps
  // a mark that fell this tick and a shot that waited for the next would find nowhere to come down.
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

/** Freeze a stranded shot's aim on the spot its fallen mark last stood, and return it: the shot flies on
 *  and lands there dealing nothing. No re-target - the original's homing-vs-ballistic behaviour is
 *  unreadable (source basis), so picking a new victim after release would be a different mechanic. Returns
 *  null, having destroyed the shot, when the mark has no readable Position left to land on. */
function freezeAim(world: World, p: Entity, target: Entity): { x: Fixed; y: Fixed } | null {
  const last = world.tryGet(target, Position);
  if (last === undefined) {
    world.destroy(p);
    return null;
  }
  const aim = { x: last.x, y: last.y };
  world.write(p, Projectile, (v) => {
    v.missAim = aim;
  });
  return aim;
}

/** Step projectile `p` one tick straight toward `(ax, ay)`; true when this tick's step reaches it. The
 *  in-flight unit-vector division is safe: `dist > step > 0` on the stepping branch. */
function flightStep(world: World, p: Entity, ax: Fixed, ay: Fixed, speed: number): boolean {
  const pos = world.get(p, Position);
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

/** The per-tick tile step a projectile of extracted `speed` advances - `speed × {@link
 *  PROJECTILE_TILES_PER_SPEED_UNIT}` in fixed-point. A positive `speed` (the launch gate guarantees it)
 *  yields a positive step, so a projectile always closes on its target. */
function projectileStep(speed: number): Fixed {
  return fx.mul(fx.fromInt(speed), PROJECTILE_TILES_PER_SPEED_UNIT);
}
