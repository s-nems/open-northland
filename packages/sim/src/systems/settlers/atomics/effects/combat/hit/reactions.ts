import {
  Age,
  Anger,
  AttackOrder,
  diplomacyStance,
  Engagement,
  FOG_MODE,
  Frightened,
  Health,
  isWildlife,
  Owner,
  ownerOf,
  PlayerOrder,
  Position,
  Resting,
  recordContact,
  Settler,
  type SettlerIdentity,
  setDiplomacyStance,
  Weapon,
} from '../../../../../../components/index.js';
import type { Entity, World } from '../../../../../../ecs/world.js';
import { rowReachLeft, rowReachRight } from '../../../../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../../../nav/terrain/index.js';
import { holdEnemy } from '../../../../../conflict/chase.js';
import { passIndexOf } from '../../../../../conflict/combat-index.js';
import { combatTargetNode } from '../../../../../conflict/target-node.js';
import {
  angryAnimal,
  firingBuildings,
  isValidTarget,
  keepsWildTarget,
  strikeRank,
  turnsAsideUnder,
} from '../../../../../conflict/targeting.js';
import { standsAtPost } from '../../../../../conflict/tower-post.js';
import { hasGivenUpTarget } from '../../../../../conflict/unreachable-targets.js';
import { withinBand } from '../../../../../conflict/weapon-band.js';
import { attackerWeapon } from '../../../../../conflict/weapons.js';
import type { SystemContext } from '../../../../../context.js';
import { herdLeaderOf } from '../../../../../movement/herd-leader.js';
import { settlersByNode } from '../../../../../movement/settler-nodes.js';
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
 * Original behavior: `angryGameTime` counts down once per game tick, the unit of this sim's tick.
 */
function provokeAnger(world: World, ctx: SystemContext, target: Entity): void {
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
 * points. Owner rule: their ranks ({@link STRIKE_RANK}) decide first, so a striker of a higher rank wins
 * however near the held enemy, one of a lower rank never takes the fighter off it, and only equal ranks
 * fall back to the distance. An archer shooting from a tower strikes as the tower, the only body of it a
 * fighter can reach. A striker the fighter gave up as unreachable is answered only from within its reach
 * while it remembers that.
 * An attack order holds against the reaction unless it lets the fighter turn aside
 * ({@link turnsAsideUnder}) and the striker outranks its target, which it takes up again afterwards.
 * Original behavior: a walking soldier ignores a blow only for its first ten steps, then turns. Deviation:
 * a plain move order is the player's and holds for its whole walk; attack-move turns.
 */
export function turnOnAttacker(world: World, ctx: SystemContext, attacker: Entity, victim: Entity): void {
  const terrain = ctx.terrain;
  const settler = world.tryGet(victim, Settler);
  if (terrain === undefined || settler === undefined || !world.has(victim, Owner)) return;
  if (!isFighterJob(ctx.content, settler.jobType)) return;
  const playerOrder = world.tryGet(victim, PlayerOrder);
  if (playerOrder !== undefined && playerOrder.attackMove === undefined) return;
  const mode = stanceMode(world, ctx.content, victim, settler.jobType);
  if (mode !== MILITARY_MODE.ATTACK && mode !== MILITARY_MODE.DEFEND) return;
  const striker = standsAtPost(world, attacker) ?? attacker;
  if (!world.has(striker, Position) || !isValidTarget(world, ctx, victim, settler, striker)) return;
  const engagement = world.tryGet(victim, Engagement);
  const held = engagement?.target;
  if (held === striker) return;
  const here = entityNode(world, terrain, victim);
  if (
    hasGivenUpTarget(world, ctx, victim, striker) &&
    !withinOwnBand(world, ctx, victim, settler, reachFrom(world, ctx, terrain, here, striker))
  )
    return;
  // A melee blow lands before the combat pass, whose index would otherwise hold the firing set.
  const firingNow = passIndexOf(world, ctx.tick)?.firingNow ?? lazyFiringBuildings(world, ctx);
  const strikerRank = strikeRank(world, ctx, striker, firingNow);
  const order = world.tryGet(victim, AttackOrder);
  if (
    order !== undefined &&
    !(
      turnsAsideUnder(world, ctx, order, firingNow) &&
      strikerRank < strikeRank(world, ctx, order.target, firingNow)
    )
  ) {
    return;
  }
  if (held !== undefined && world.isAlive(held) && world.has(held, Position)) {
    const heldRank = strikeRank(world, ctx, held, firingNow);
    if (heldRank < strikerRank) return;
    if (
      heldRank === strikerRank &&
      reachFrom(world, ctx, terrain, here, held) <= reachFrom(world, ctx, terrain, here, striker)
    )
      return;
  }
  holdEnemy(world, ctx, victim, striker);
}

/** How far (map points) `t`'s combat node lies from `here`. */
function reachFrom(world: World, ctx: SystemContext, terrain: TerrainGraph, here: NodeId, t: Entity): number {
  return hexNodeDistance(terrain, here, combatTargetNode(world, ctx, terrain, here, t));
}

/** The firing set as a getter that derives it on first read. */
function lazyFiringBuildings(world: World, ctx: SystemContext): () => ReadonlySet<Entity> {
  let firing: ReadonlySet<Entity> | undefined;
  return () => {
    firing ??= firingBuildings(world, ctx);
    return firing;
  };
}

/** Whether `dist` map points lies inside the band of the weapon `victim` fights with, where an enemy it gave
 *  up as unreachable is still one it can strike, as on a pick. */
function withinOwnBand(
  world: World,
  ctx: SystemContext,
  victim: Entity,
  settler: SettlerIdentity,
  dist: number,
): boolean {
  const weapon = attackerWeapon(
    ctx,
    settler.tribe,
    settler.jobType,
    world.tryGet(victim, Weapon)?.weaponTypeId,
    settler.humanForm,
  );
  return weapon !== null && withinBand(weapon, dist);
}

/** How far (map points) a blow on an animal carries to the animals of its kind and side. Original behavior. */
export const KIN_ALARM_RADIUS_NODES = 20;

/**
 * An animal's answer to a blow, and its kin's. Original behavior: the struck animal and every animal of its
 * kind and side within {@link KIN_ALARM_RADIUS_NODES} of it react as if struck, the kin by a blow of no
 * damage: a `getAngry` one grows angry, and then each in turn {@link answerBlow}s. Leaders answer before
 * followers, so a follower reads whether its leader runs; the fright drive sends a fleeing leader's
 * followers after it.
 */
export function reactToBlowOnAnimal(
  world: World,
  ctx: SystemContext,
  attacker: Entity,
  struck: Entity,
): void {
  const terrain = ctx.terrain;
  const kind = world.tryGet(struck, Settler)?.tribe;
  if (terrain === undefined || kind === undefined || !world.has(struck, Position)) return;
  if (!isWildlife(world, struck)) return;
  const side = ownerOf(world, struck);
  const at = entityNode(world, terrain, struck);
  const threat = world.has(attacker, Position) ? entityNode(world, terrain, attacker) : at;
  const herd = kinWithin(world, terrain, at, struck, kind, side);
  for (const e of herd) provokeAnger(world, ctx, e);
  for (const e of herd) if (herdLeaderOf(world, e) === e) answerBlow(world, ctx, attacker, e, threat);
  for (const e of herd) if (herdLeaderOf(world, e) !== e) answerBlow(world, ctx, attacker, e, threat);
}

/**
 * One animal's answer to a blow from `attacker`. Original behavior: an adult, angry animal struck by a
 * person or animal of another side takes the striker for its target, unless it already holds one or its
 * leader runs; otherwise a leader runs from the blow, and a follower does nothing of its own.
 * Approximation: a player's animal fights through no drive of this sim, so an angry one runs like a calm one.
 */
function answerBlow(world: World, ctx: SystemContext, attacker: Entity, e: Entity, threat: NodeId): void {
  if ((world.tryGet(e, Health)?.hitpoints ?? 0) <= 0) return;
  const tribe = world.get(e, Settler).tribe;
  const fights =
    !world.has(e, Owner) &&
    !world.has(e, Age) &&
    angryAnimal(world, ctx, e, tribe) &&
    world.has(attacker, Settler) &&
    !sameSide(world, attacker, e);
  if (fights) {
    const held = world.tryGet(e, Engagement)?.target;
    if (held !== undefined && keepsWildTarget(world, e, held)) return;
    if (world.has(herdLeaderOf(world, e), Frightened)) return;
    if (!keepsWildTarget(world, e, attacker)) return;
    if (held === undefined) world.add(e, Engagement, { repathAt: ctx.tick, target: attacker });
    else world.mut(e, Engagement).target = attacker;
    return;
  }
  if (herdLeaderOf(world, e) !== e) return;
  const fright = world.tryMut(e, Frightened);
  if (fright === undefined) world.add(e, Frightened, { from: threat, dest: null });
  else {
    // A fresh blow re-aims the flight: it may come from the other side.
    fright.from = threat;
    fright.dest = null;
    fright.scatter = undefined;
  }
}

/** Whether `attacker` strikes from `animal`'s own side: the same player, or both wild, where no person is. */
function sameSide(world: World, attacker: Entity, animal: Entity): boolean {
  const side = ownerOf(world, animal);
  if (ownerOf(world, attacker) !== side) return false;
  return side !== undefined || isWildlife(world, attacker);
}

/** The struck animal and its kin of `kind` and `side` within {@link KIN_ALARM_RADIUS_NODES} of `at`, out in
 *  the open, ascending by id. */
function kinWithin(
  world: World,
  terrain: TerrainGraph,
  at: NodeId,
  struck: Entity,
  kind: number,
  side: number | undefined,
): Entity[] {
  const centre = { hx: terrain.xOf(at), hy: terrain.yOf(at) };
  const byNode = settlersByNode(world);
  const herd: Entity[] = [];
  const lastRow = Math.min(terrain.height - 1, centre.hy + KIN_ALARM_RADIUS_NODES);
  for (let hy = Math.max(0, centre.hy - KIN_ALARM_RADIUS_NODES); hy <= lastRow; hy++) {
    const right = Math.min(terrain.width - 1, rowReachRight(centre, hy, KIN_ALARM_RADIUS_NODES));
    for (let hx = Math.max(0, rowReachLeft(centre, hy, KIN_ALARM_RADIUS_NODES)); hx <= right; hx++) {
      for (const e of byNode.at(hx, hy)) {
        if (e !== struck && world.has(e, Resting)) continue; // indoors, out of earshot
        if (world.get(e, Settler).tribe !== kind || ownerOf(world, e) !== side) continue;
        if (isWildlife(world, e)) herd.push(e);
      }
    }
  }
  if (!herd.includes(struck)) herd.push(struck);
  return herd.sort((a, b) => a - b);
}
