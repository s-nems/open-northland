import {
  Anger,
  AttackOrder,
  diplomacyStance,
  Engagement,
  FOG_MODE,
  Owner,
  Position,
  recordContact,
  Settler,
  StayPoint,
  setDiplomacyStance,
} from '../../../../../../components/index.js';
import type { Entity, World } from '../../../../../../ecs/world.js';
import { frightenKin } from '../../../../../conflict/fright.js';
import { combatTargetNode } from '../../../../../conflict/target-node.js';
import { isValidTarget } from '../../../../../conflict/targeting.js';
import type { SystemContext } from '../../../../../context.js';
import {
  angryGameTimeOf,
  isAggressiveAnimal,
  isFighterJob,
  isProvokableAnimal,
  MILITARY_MODE,
  stanceMode,
} from '../../../../../readviews/index.js';
import { hexNodeDistance } from '../../../../../spatial/metric.js';
import { entityNode } from '../../../../../spatial/nodes.js';

/**
 * Provoke a struck passive `getAngry` animal into temporary hostility - the provoked half of
 * `animaltypes.ini` aggression. Stamps an {@link Anger} deadline the `combatSystem` reads to make the
 * animal fight back until it lapses; a re-strike refreshes it, so harassment keeps the animal angry.
 */
export function provokeAnger(world: World, ctx: SystemContext, target: Entity): void {
  const settler = world.tryGet(target, Settler);
  if (settler === undefined) return;
  if (!isProvokableAnimal(ctx.content, settler.tribe)) return;
  // An always-aggressive animal needs no timer, and stamping one would leak a component `hostileAnimalNow`
  // never reaps: it short-circuits on `isAggressiveAnimal` before ever reading `Anger`.
  if (isAggressiveAnimal(ctx.content, settler.tribe)) return;
  const duration = angryGameTimeOf(ctx.content, settler.tribe);
  if (duration <= 0) return; // no readable duration - no lasting anger
  const until = ctx.tick + duration;
  const anger = world.tryMut(target, Anger);
  if (anger === undefined) world.add(target, Anger, { until });
  else anger.until = until;
}

/**
 * Send a struck animal and its kin running from its attacker, unless the blow provoked it. Original
 * behavior: a blow, not a loosed shot, sends game running.
 */
export function frightenStruckAnimal(
  world: World,
  ctx: SystemContext,
  attacker: Entity,
  target: Entity,
): void {
  const terrain = ctx.terrain;
  if (terrain === undefined || !world.has(target, StayPoint) || !world.has(target, Position)) return;
  // A shot outlives a slain archer; its quarry then runs from where it stands.
  const threat = world.has(attacker, Position) ? attacker : target;
  frightenKin(world, ctx, terrain, target, entityNode(world, terrain, threat));
}

/**
 * Turn a struck player against its aggressor: the victim's directed stance flips to `enemy` on a landed
 * blow, so a one-way authored pair ends in retaliation through the same table engagement reads. The
 * player-axis twin of {@link provokeAnger}, and permanent where anger lapses (source basis: observed
 * original behavior). The already-`enemy` guard keeps a default-hostile world from ever growing the
 * `DiplomacyRules` singleton, so pre-diplomacy hashes stay put.
 */
export function provokeHostility(world: World, ctx: SystemContext, attacker: Entity, target: Entity): void {
  const attackerOwner = world.tryGet(attacker, Owner);
  const targetOwner = world.tryGet(target, Owner);
  if (attackerOwner === undefined || targetOwner === undefined) return;
  if (attackerOwner.player === targetOwner.player) return;
  // A blow also teaches the victim who struck it, even from beyond every eye (a standoff archer), so
  // the diplomacy roster cannot show nobody while units die. Approximation: the original's first-
  // contact trigger is unobserved. Fog-off worlds skip the write - discovery already reads true there.
  if (ctx.fog !== undefined && ctx.fog.activeMode !== FOG_MODE.OFF) {
    recordContact(world, targetOwner.player, attackerOwner.player);
  }
  if (diplomacyStance(world, targetOwner.player, attackerOwner.player) === 'enemy') return;
  setDiplomacyStance(world, targetOwner.player, attackerOwner.player, 'enemy');
}

/**
 * Turn a struck fighter on its attacker. Original behavior: a soldier or hero under ATTACK or DEFEND takes
 * the one who struck it for its target, unless the enemy it already holds stands no farther off in map
 * points. Only an owned fighter holds a target, and an attack order outranks the reaction.
 */
export function turnOnAttacker(world: World, ctx: SystemContext, attacker: Entity, victim: Entity): void {
  const terrain = ctx.terrain;
  const settler = world.tryGet(victim, Settler);
  if (terrain === undefined || settler === undefined || !world.has(victim, Owner)) return;
  if (world.has(victim, AttackOrder) || !isFighterJob(ctx.content, settler.jobType)) return;
  const mode = stanceMode(world, ctx.content, victim, settler.jobType);
  if (mode !== MILITARY_MODE.ATTACK && mode !== MILITARY_MODE.DEFEND) return;
  if (!world.has(attacker, Position) || !isValidTarget(world, ctx, victim, settler, attacker)) return;
  const here = entityNode(world, terrain, victim);
  const reach = (t: Entity): number =>
    hexNodeDistance(terrain, here, combatTargetNode(world, ctx, terrain, here, t));
  const engagement = world.tryGet(victim, Engagement);
  const held = engagement?.target;
  if (held === attacker) return;
  if (
    held !== undefined &&
    world.isAlive(held) &&
    world.has(held, Position) &&
    reach(held) <= reach(attacker)
  ) {
    return;
  }
  if (engagement === undefined) world.add(victim, Engagement, { repathAt: ctx.tick, target: attacker });
  else world.mut(victim, Engagement).target = attacker;
}
