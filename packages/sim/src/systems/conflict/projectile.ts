import {
  Building,
  Health,
  isWildlife,
  Owner,
  Palisade,
  Position,
  Projectile,
  Resting,
  Settler,
} from '../../components/index.js';
import { eventAt } from '../../core/events.js';
import { type Fixed, fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import { weaponDamageVsMaterial } from '../readviews/index.js';
import {
  applyPendingHitReactions,
  type PendingHitReaction,
  resolveCombatHit,
} from '../settlers/atomics/effects/combat/index.js';
import { entityNode } from '../spatial/nodes.js';
import { passIndexOf } from './combat-index.js';
import { projectileStep } from './shot-aim.js';
import { resolveGroundImpact } from './ground-impact.js';
import { targetBodyNodes } from './target-node.js';
import { isStructureTarget, mayTarget } from './targeting.js';
import { damageVsTarget, glancesOff, hitSoundVsMaterial, targetMaterial } from './weapons.js';

export { PROJECTILE_TILES_PER_SPEED_UNIT } from './shot-aim.js';

type Flight = NonNullable<(typeof Projectile)['__value']>;

/**
 * ProjectileSystem - advance every in-flight {@link Projectile} one tick along its release-time chord and,
 * where it comes down, strike whatever stands there. The launch is the AtomicSystem's `attack` effect at the
 * shooter's release frame, or a defence-mode building's own shot; the hit runs the same
 * {@link resolveCombatHit} a melee swing does.
 *
 * Projectiles are visited in canonical ascending-id order and a victim's reaction is deferred past the
 * loop, so a flinch tie-break is order-independent. Cost scales with the count of active projectiles:
 * nothing else scans them, a landing asks the combat index about one node, and a spent shot is destroyed
 * the instant it lands.
 */
export const projectileSystem: System = (world, ctx) => {
  // Deferred reactions from any survivor struck this tick, so a flinch added mid-loop cannot perturb a
  // later projectile's hit decision.
  const pendingReactions: PendingHitReaction[] = [];
  for (const p of world.canonicalQuery(Projectile, Position)) {
    const proj = world.get(p, Projectile);
    // Loosed this tick: it does not move, so a shot is observable at its launch point (approximated - the
    // sub-tick release instant is unreadable).
    if (proj.launchTick === ctx.tick) continue;
    if (flightStep(world, p, proj.aimX, proj.aimY, proj.speed)) land(world, ctx, p, proj, pendingReactions);
  }
  applyPendingHitReactions(world, pendingReactions);
};

/** Bring shot `p` down at its aim: the blow lands on whatever it strikes there, a siege shot's on everything
 *  there, or it thuds into the dirt. */
function land(
  world: World,
  ctx: SystemContext,
  p: Entity,
  proj: Flight,
  pendingReactions: PendingHitReaction[],
): void {
  const at = eventAt(proj.aimX, proj.aimY);
  const burst =
    proj.impact !== null &&
    ctx.terrain !== undefined &&
    resolveGroundImpact(world, ctx, ctx.terrain, p, proj, pendingReactions);
  const victim = proj.impact === null ? struckVictim(world, ctx, proj) : null;
  if (burst) {
    world.destroy(p);
    return;
  }
  if (victim === null) {
    ctx.events.emit({
      kind: 'projectileMissed',
      projectile: p,
      shooter: proj.source,
      munitionType: proj.munitionType,
      at,
      missSounds: proj.missSounds,
    });
    world.destroy(p);
    return;
  }
  // The victim's armor picks the damage column and the impact sound, as a melee swing's does.
  const material = targetMaterial(world, ctx, victim);
  const damage = damageVsTarget(world, victim, weaponDamageVsMaterial(proj, material));
  const hitSoundType = glancesOff(world, victim, damage)
    ? null
    : (hitSoundVsMaterial(proj, material) ?? null);
  const blow = { damage, weaponMainType: proj.weaponMainType, hitSoundType };
  // Ranged: the projectile announces its own `projectileHit`, not a melee `combatHit`.
  resolveCombatHit(world, ctx, proj.source, victim, blow, pendingReactions, 'projectile');
  ctx.events.emit({
    kind: 'projectileHit',
    projectile: p,
    shooter: proj.source,
    target: victim,
    munitionType: proj.munitionType,
    at,
    ...(hitSoundType !== null ? { soundType: hitSoundType } : {}),
    ...(isStructureTarget(world, victim) ? { structure: true } : {}),
  });
  world.destroy(p);
}

/**
 * What a shot coming down at its aim strikes: the victim it was loosed at, when it stands there; otherwise
 * the lowest-id man or beast there, and failing one, a building whose body covers the node. Original
 * behavior: a shot strikes the first thing standing where it lands, and a building only when nobody stands
 * there; it passes over its own side's, and also, as an approximation, over those of friends and neutrals.
 * Preferring the victim loosed at stands in for the original's own order on a shared node. With no combat
 * pass this tick no fight was possible, so only that victim can be struck.
 */
function struckVictim(world: World, ctx: SystemContext, proj: Flight): Entity | null {
  const terrain = ctx.terrain;
  const target = proj.target;
  if (terrain === undefined) return target !== null && strikeable(world, target) ? target : null;
  const landing = terrain.nodeAtClamped(nodeHxOfPosition(proj.aimX, proj.aimY), nodeHyOfPosition(proj.aimY));
  if (target !== null && strikeable(world, target) && stands(world, ctx, terrain, target, landing))
    return target;
  const index = passIndexOf(world, ctx.tick);
  if (index === null) return null;
  const x = terrain.xOf(landing);
  const y = terrain.yOf(landing);
  const onNode = (building: boolean) => (e: Entity) =>
    world.has(e, Building) === building && strikeable(world, e) && strayMayStrike(world, ctx, proj, e);
  return (
    index.nearest(x, y, 0, 0, onNode(false), proj.player)?.entity ??
    index.nearest(x, y, 0, 0, onNode(true), proj.player)?.entity ??
    null
  );
}

/**
 * Whether a stray shot strikes `e`, beyond the player sides the combat index already spares. A wild
 * animal is struck like anyone else. A side without a player, an unowned shooter or bystander, is spared
 * unless its tribe is hostile to the shooter's, and an ownerless building is never struck.
 */
function strayMayStrike(world: World, ctx: SystemContext, proj: Flight, e: Entity): boolean {
  if (e === proj.source) return false;
  if (world.has(e, Building)) return world.has(e, Owner);
  if (isWildlife(world, e)) return true;
  if (proj.player !== null && world.has(e, Owner)) return true;
  const shooter = world.tryGet(proj.source, Settler);
  const bystander = world.tryGet(e, Settler);
  if (shooter === undefined || bystander === undefined) return false;
  return mayTarget(world, ctx, proj.source, shooter.tribe, shooter.jobType, e, bystander.tribe);
}

/** Whether `e` is there to be struck: alive, placed, and not sheltering indoors. */
function strikeable(world: World, e: Entity): boolean {
  const health = world.tryGet(e, Health);
  if (health === undefined || health.hitpoints <= 0) return false;
  return world.has(e, Position) && !world.has(e, Resting);
}

/** Whether `e` stands on `node`: its own node, or any node of a building's, a wall's or a vehicle's body. */
function stands(world: World, ctx: SystemContext, terrain: TerrainGraph, e: Entity, node: NodeId): boolean {
  const body = targetBodyNodes(world, ctx, terrain, e);
  return body === null ? entityNode(world, terrain, e) === node : body.includes(node);
}

/** Step projectile `p` one tick straight toward `(ax, ay)`; true when it began this tick at the aim. The
 *  arrival is held for one snapshot before contact resolution, so presentation can interpolate the final
 *  segment instead of removing the arrow up to one full step short. The in-flight unit-vector division is
 *  safe: `dist > step > 0` on the stepping branch. */
function flightStep(world: World, p: Entity, ax: Fixed, ay: Fixed, speed: number): boolean {
  const pos = world.mut(p, Position);
  const dx = fx.sub(ax, pos.x);
  const dy = fx.sub(ay, pos.y);
  const dist = fx.isqrt(fx.add(fx.mul(dx, dx), fx.mul(dy, dy)));
  const step = projectileStep(speed);
  if (dist === 0) return true;
  if (dist <= step) {
    pos.x = ax;
    pos.y = ay;
    return false;
  }
  const ux = fx.div(dx, dist);
  const uy = fx.div(dy, dist);
  pos.x = fx.add(pos.x, fx.mul(ux, step));
  pos.y = fx.add(pos.y, fx.mul(uy, step));
  return false;
}
