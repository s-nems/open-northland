import {
  Building,
  Health,
  isWildlife,
  Owner,
  Position,
  Projectile,
  type ProjectileImpact,
  Resting,
  Settler,
} from '../../components/index.js';
import { eventAt } from '../../core/events.js';
import { fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexNeighboursOf, nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import { grantFightExperience } from '../progression/index.js';
import { weaponDamageVsMaterial } from '../readviews/index.js';
import {
  applyPendingHitReactions,
  type PendingHitReaction,
  resolveCombatHit,
} from '../settlers/atomics/effects/combat/index.js';
import { entityNode } from '../spatial/nodes.js';
import { passIndexOf } from './combat-index.js';
import { resolveGroundImpact } from './ground-impact.js';
import { targetBodyNodes } from './target-node.js';
import { isStructureTarget, mayTarget } from './targeting.js';
import { damageVsTarget, hitSoundVsMaterial, targetMaterial } from './weapons.js';

type Flight = NonNullable<(typeof Projectile)['__value']>;

/** The most objects one shot strikes. Original behavior: the list a landing collects holds 100. */
const STRUCK_LIST_CAPACITY = 100;

/**
 * ProjectileSystem - carry every in-flight {@link Projectile} along its release-time chord and, on its land
 * tick, strike what stands where it comes down. The launch is the AtomicSystem's `attack` effect at the
 * shooter's release frame, or a defence-mode building's own shot; each hit runs the same
 * {@link resolveCombatHit} a melee swing does.
 *
 * Projectiles are visited in canonical ascending-id order and a victim's reaction is deferred past the
 * loop, so a flinch tie-break is order-independent. Cost scales with the count of active projectiles:
 * nothing else scans them, a landing asks the combat index about one node (seven for an area shot), and a
 * spent shot is destroyed the instant it lands.
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
    if (ctx.tick >= proj.landTick) land(world, ctx, p, proj, pendingReactions);
    else fly(world, p, proj, ctx.tick);
  }
  applyPendingHitReactions(world, pendingReactions);
};

/**
 * Place shot `p` on its chord for `tick`. It reaches the aim the tick before it lands and is held there
 * for that one snapshot, so presentation interpolates the final segment instead of removing the arrow
 * short of it.
 */
function fly(world: World, p: Entity, proj: Flight, tick: number): void {
  const span = fx.fromInt(Math.max(1, proj.landTick - proj.launchTick - 1));
  const flown = fx.fromInt(Math.min(tick - proj.launchTick, fx.toInt(span)));
  const pos = world.mut(p, Position);
  pos.x = fx.add(proj.originX, fx.mulDiv(fx.sub(proj.aimX, proj.originX), flown, span));
  pos.y = fx.add(proj.originY, fx.mulDiv(fx.sub(proj.aimY, proj.originY), flown, span));
}

/** Bring shot `p` down at its aim: the blow lands on what it strikes there, a siege shot's on everything
 *  there, or it thuds into the dirt. */
function land(
  world: World,
  ctx: SystemContext,
  p: Entity,
  proj: Flight,
  pendingReactions: PendingHitReaction[],
): void {
  const at = eventAt(proj.aimX, proj.aimY);
  if (proj.impact !== null) {
    burst(world, ctx, p, proj, proj.impact, pendingReactions);
    return;
  }
  let struckAny = false;
  for (const victim of struckVictims(world, ctx, proj)) {
    const hitSoundType = hitSoundVsMaterial(proj, targetMaterial(world, ctx, victim));
    // Original behavior: a shot that does its victim no damage thuds like one that strikes nothing.
    if (!strike(world, ctx, proj, victim, pendingReactions)) continue;
    struckAny = true;
    // Ranged: the projectile announces its own `projectileHit`, not a melee `combatHit`.
    ctx.events.emit({
      kind: 'projectileHit',
      projectile: p,
      shooter: proj.source,
      target: victim,
      munitionType: proj.munitionType,
      at,
      ...(hitSoundType !== undefined ? { soundType: hitSoundType } : {}),
      ...(isStructureTarget(world, victim) ? { structure: true } : {}),
    });
  }
  // Original behavior: a shot that did damage trains its shooter once, however many it struck.
  if (struckAny) grantFightExperience(world, ctx, proj.source, proj.weaponMainType ?? undefined);
  if (!struckAny) {
    ctx.events.emit({
      kind: 'projectileMissed',
      projectile: p,
      shooter: proj.source,
      munitionType: proj.munitionType,
      at,
      missSounds: proj.missSounds,
    });
  }
  world.destroy(p);
}

/** A siege shot comes down: everything on its node takes the blow ({@link resolveGroundImpact}), or it
 *  thuds into the dirt, and the burst is announced either way for its smoke. */
function burst(
  world: World,
  ctx: SystemContext,
  p: Entity,
  proj: Flight,
  impact: ProjectileImpact,
  pendingReactions: PendingHitReaction[],
): void {
  const at = eventAt(proj.aimX, proj.aimY);
  const struck =
    ctx.terrain !== undefined && resolveGroundImpact(world, ctx, ctx.terrain, p, proj, pendingReactions);
  // Original behavior: a stone that did damage trains its commander once, however many it struck.
  if (struck) grantFightExperience(world, ctx, proj.source, proj.weaponMainType ?? undefined);
  if (!struck) {
    ctx.events.emit({
      kind: 'projectileMissed',
      projectile: p,
      shooter: proj.source,
      munitionType: proj.munitionType,
      at,
      missSounds: proj.missSounds,
    });
  }
  ctx.events.emit({
    kind: 'groundBurst',
    projectile: p,
    munitionType: proj.munitionType,
    at,
    ...(impact.smokeTicks !== null ? { smokeTicks: impact.smokeTicks } : {}),
  });
  world.destroy(p);
}

/** Land shot `proj`'s blow on `victim`; true when it did damage. The victim's armor picks the damage
 *  column, as a melee swing's does. Original behavior: the blow comes from where the shot was loosed,
 *  which a person's hit direction reads. */
function strike(
  world: World,
  ctx: SystemContext,
  proj: Flight,
  victim: Entity,
  pendingReactions: PendingHitReaction[],
): boolean {
  const material = targetMaterial(world, ctx, victim);
  const blow = {
    damage: damageVsTarget(world, victim, weaponDamageVsMaterial(proj, material)),
    weaponMainType: proj.weaponMainType,
    hitSoundType: hitSoundVsMaterial(proj, material) ?? null,
    from: { x: proj.originX, y: proj.originY },
  };
  return resolveCombatHit(world, ctx, proj.source, victim, blow, pendingReactions, 'projectile');
}

/**
 * What a shot coming down at its aim strikes. Original behavior: a shot strikes the first thing standing
 * where it lands, men and beasts before a building, and an area shot strikes everything on the landing
 * point and its six neighbours. A shot passes over its own side's, and also, as an approximation, over
 * those of friends and neutrals; a `hitSelf` weapon passes over nobody.
 *
 * Approximation, differing on any shared node: the original takes the first entry of the node's own list
 * of standing units, then the house there, and never prefers the victim it was loosed at. Here the first
 * thing is that victim when it stands there, then the lowest-id man or beast, then a building whose body
 * covers the node. An area shot here collects every man and beast of the seven nodes before any building,
 * where the original fills its list node by node; the two differ only past its 100-object cap. With no
 * combat pass this tick no fight was possible, so only the victim loosed at can be struck.
 */
function struckVictims(world: World, ctx: SystemContext, proj: Flight): readonly Entity[] {
  const terrain = ctx.terrain;
  const target = proj.target !== null && strikeable(world, proj.target) ? proj.target : null;
  if (terrain === undefined) return target === null ? [] : [target];
  const landing = terrain.nodeAtClamped(nodeHxOfPosition(proj.aimX, proj.aimY), nodeHyOfPosition(proj.aimY));
  const nodes = proj.area ? [landing, ...inBoundsNeighbours(terrain, landing)] : [landing];
  const targetThere = target !== null && nodes.some((node) => stands(world, ctx, terrain, target, node));
  const index = passIndexOf(world, ctx.tick);
  if (index === null) return targetThere && target !== null ? [target] : [];
  if (targetThere && target !== null && !proj.area) return [target];
  const seeker = proj.hitSelf ? null : proj.player;
  const onNode = (building: boolean) => (e: Entity) =>
    world.has(e, Building) === building && strikeable(world, e) && strayMayStrike(world, ctx, proj, e);
  if (!proj.area) {
    const x = terrain.xOf(landing);
    const y = terrain.yOf(landing);
    const first =
      index.nearest(x, y, 0, 0, onNode(false), seeker)?.entity ??
      index.nearest(x, y, 0, 0, onNode(true), seeker)?.entity;
    return first === undefined ? [] : [first];
  }
  const struck = new Set<Entity>();
  for (const building of [false, true]) {
    for (const node of nodes) {
      const x = terrain.xOf(node);
      const y = terrain.yOf(node);
      const room = STRUCK_LIST_CAPACITY - struck.size;
      if (room <= 0) break;
      for (const { entity } of index.nearestFew(x, y, 0, 0, onNode(building), room, seeker, 0)) {
        struck.add(entity);
      }
    }
  }
  return [...struck];
}

/** The six map-point neighbours of `node` that lie on the map. */
function inBoundsNeighbours(terrain: TerrainGraph, node: NodeId): NodeId[] {
  return hexNeighboursOf(terrain.xOf(node), terrain.yOf(node))
    .filter((n) => terrain.inBounds(n.hx, n.hy))
    .map((n) => terrain.nodeAt(n.hx, n.hy));
}

/**
 * Whether a stray shot strikes `e`, beyond the player sides the combat index already spares. A wild
 * animal is struck like anyone else, and so is every man under a `hitSelf` weapon. A side without a
 * player, an unowned shooter or bystander, is otherwise spared unless its tribe is hostile to the
 * shooter's, and an ownerless building is never struck.
 */
function strayMayStrike(world: World, ctx: SystemContext, proj: Flight, e: Entity): boolean {
  if (e === proj.source) return false;
  if (world.has(e, Building)) return world.has(e, Owner);
  if (isWildlife(world, e) || proj.hitSelf) return true;
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
