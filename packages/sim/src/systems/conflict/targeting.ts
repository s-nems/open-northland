import {
  Anger,
  Building,
  diplomacyStance,
  Engagement,
  Garrison,
  Health,
  isWildlife,
  Owner,
  Palisade,
  Position,
  Settler,
  type SettlerIdentity,
  StayPoint,
  Vehicle,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { isManningShelter, shelterOccupancy, shelterStillHolds } from '../defence/index.js';
import { herdLeaderOf } from '../movement/herd-leader.js';
import {
  animalCannotBeAttacked,
  houseBow,
  isAggressiveAnimal,
  isAnimalTribe,
  mayAttack,
  mayHunt,
} from '../readviews/index.js';
import { hexNodeDistance } from '../spatial/metric.js';
import { isManningPost, standsAtPost } from './tower-post.js';
import { vehicleWeapon } from './weapons.js';

// The combat targeting relations: who may fight whom, how far a combatant spots an enemy, and what a wild
// animal takes up. A leaf of conflict/ - nothing here reaches back into the drives that consult it.

/**
 * How far (map points) an owned combatant looks for an enemy to advance on - the radius an ATTACK fighter
 * scans around itself whatever its weapon's reach, and a fleeing unit for a threat. Original behavior.
 */
export const SIGHT_RADIUS_NODES = 18;

/** How far from its stay point a wild herd leader looks for a victim, in map points; one without a stay
 *  point looks around itself. Original behavior. */
export const ANIMAL_AGGRO_RADIUS_NODES = 20;

/** How far from its stay point, in map points, a wild animal still takes up a target. Original behavior:
 *  one pursuing past it drops its target and walks back to its stay point. */
export const ANIMAL_LEASH_NODES = 40;

/** What an unowned animal's attack drive does this pass: fight `target` on the leash of its stay point,
 *  search around `center`, walk back to `stay` having pursued past its leash, or nothing. */
export type WildPursuit =
  | { readonly kind: 'hold'; readonly target: Entity; readonly stay: NodeId | undefined }
  | { readonly kind: 'search'; readonly center: NodeId }
  | { readonly kind: 'return'; readonly stay: NodeId }
  | { readonly kind: 'idle' };

const WILD_IDLE: WildPursuit = { kind: 'idle' };

/**
 * An unowned animal's pursuit this pass. Original behavior: an animal keeps its target, and a follower
 * without one copies its leader's; a leader without one searches around its stay point. Past the leash
 * nothing is taken up, and a pursuit is dropped. Approximation: the leash is read every pass rather than
 * at each map point reached, and a follower's leash counts from its own stay point.
 */
export function wildPursuit(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  here: NodeId,
  attacker: SettlerIdentity,
): WildPursuit {
  const stay = world.tryGet(e, StayPoint)?.cell;
  if (stay !== undefined && hexNodeDistance(terrain, here, stay) > ANIMAL_LEASH_NODES) {
    return world.has(e, Engagement) ? { kind: 'return', stay } : WILD_IDLE;
  }
  const own = world.tryGet(e, Engagement)?.target;
  if (own !== undefined && isValidTarget(world, ctx, e, attacker, own)) {
    return { kind: 'hold', target: own, stay };
  }
  const leader = herdLeaderOf(world, e);
  if (leader === e) return { kind: 'search', center: stay ?? here };
  const copied = world.tryGet(leader, Engagement)?.target;
  return copied !== undefined && isValidTarget(world, ctx, e, attacker, copied)
    ? { kind: 'hold', target: copied, stay }
    : WILD_IDLE;
}

/** A building, wall or vehicle: a hit on one is an impact on a hull, not a body - no blood, no scream. */
export function isStructureTarget(world: World, t: Entity): boolean {
  return world.has(t, Building) || world.has(t, Palisade) || world.has(t, Vehicle);
}

/** Whether `t` is a live target this attacker may swing at - a positioned, `Health`-bearing enemy settler,
 *  enemy building or enemy vehicle for which the {@link mayTarget} hostility relation holds. A building or
 *  vehicle is a target only for an owned attacker, keyed on its `tribe` so the same hostility as a unit
 *  target decides. */
export function isValidTarget(
  world: World,
  ctx: SystemContext,
  self: Entity,
  attacker: SettlerIdentity,
  t: Entity,
): boolean {
  if (t === self) return false;
  if (!world.has(t, Health) || !world.has(t, Position)) return false;
  if (world.get(t, Health).hitpoints <= 0) return false;
  // A wall is never picked on sight: only a player's order, or a walk the walls bar, takes one on
  // (`palisades/breach.ts`), so a fighter left to itself walks through a gap rather than chopping every post.
  if (world.has(t, Palisade)) return false;
  const building = world.tryGet(t, Building);
  if (building !== undefined) {
    // Only a player's own units besiege buildings - an animal never turns on a structure.
    if (!world.has(self, Owner)) return false;
    // And only a player-owned building is a siege target: admitting an ownerless one would contradict the
    // dormancy gate's owned-buildings-only tail.
    if (!world.has(t, Owner)) return false;
    return mayTarget(world, ctx, self, attacker.tribe, attacker.jobType, t, building.tribe);
  }
  const vehicle = world.tryGet(t, Vehicle);
  if (vehicle !== undefined) {
    // A vehicle is a target on the building's terms: for an owned attacker, and only while someone owns
    // it; the crew inside is out of reach until the hull breaks.
    if (!world.has(self, Owner) || !world.has(t, Owner)) return false;
    return mayTarget(world, ctx, self, attacker.tribe, attacker.jobType, t, vehicle.tribe);
  }
  if (!world.has(t, Settler)) return false;
  // Anyone shooting from inside a building is out of reach, so the attackers must batter the structure to
  // get at them. Keyed on where a settler actually stands, not on the marker: one another drive walked out
  // into the open is a target like anyone else.
  if (standsAtPost(world, t) !== null) return false;
  if (!mayTarget(world, ctx, self, attacker.tribe, attacker.jobType, t, world.get(t, Settler).tribe)) {
    return false;
  }
  return !isManningShelter(world, t);
}

/**
 * Whether `t` is a target an explicit player attack order may keep swinging at: {@link isValidTarget},
 * widened by the wild creature any ordered striker may go for. Source basis: the original offers its
 * "attack animal" order to every adult man and to heroes, not only to a hunter, so the predation rule that
 * gates autonomous engagement must not drop an ordered one. Claimed livestock carries an owner and stays
 * property, decided by the rule above.
 */
export function isValidOrderedTarget(
  world: World,
  ctx: SystemContext,
  self: Entity,
  attacker: SettlerIdentity,
  t: Entity,
): boolean {
  if (isValidTarget(world, ctx, self, attacker, t)) return true;
  const wall = world.tryGet(t, Palisade);
  if (wall !== undefined) {
    if (!world.has(self, Owner) || !world.has(t, Health) || !world.has(t, Position)) return false;
    if (world.get(t, Health).hitpoints <= 0) return false;
    // A map's ownerless wall is anyone's to break; an owned one only an enemy's.
    return (
      !world.has(t, Owner) || mayTarget(world, ctx, self, attacker.tribe, attacker.jobType, t, wall.tribe)
    );
  }
  if (!world.has(self, Owner) || !isWildlife(world, t) || world.has(t, Owner)) return false;
  if (!world.has(t, Health) || !world.has(t, Position)) return false;
  if (world.get(t, Health).hitpoints <= 0) return false;
  // The decorative-fauna exemption still holds: `cannotbeattacked` is a property of the creature, not
  // of who is swinging at it.
  return !animalCannotBeAttacked(ctx.content, world.get(t, Settler).tribe);
}

/**
 * The buildings able to shoot this tick: a tower whose post a live fighter mans, and a defence-mode
 * building holding anyone, whose tribe has a house bow. The only buildings the FLEE drive runs from.
 */
export function firingBuildings(world: World, ctx: SystemContext): Set<Entity> {
  const firing = new Set<Entity>();
  for (const e of world.query(Garrison)) {
    if (isAlive(world, e) && isManningPost(world, ctx, e)) firing.add(world.get(e, Garrison).post);
  }
  for (const shelter of shelterOccupancy(world).keys()) {
    if (!isAlive(world, shelter) || !shelterStillHolds(world, ctx, shelter)) continue;
    if (houseBow(ctx.content, world.get(shelter, Building).tribe) !== undefined) firing.add(shelter);
  }
  return firing;
}

/**
 * Whether `t` is a threat the FLEE drive runs from: any valid target of the fleer, or - where the
 * directed diplomacy pair is hostile the other way only - a live enemy-stance settler in the open. A
 * building counts either way only while it is among the `firing` ones, so a civilian living beside an
 * enemy's houses keeps working; a vehicle counts only while armed, so nobody runs from a cart. Fear staying symmetric on the owner axis while engagement is directed is
 * an approximation, so a pacified player's civilians still run from a one-way aggressor.
 */
export function isFleeThreat(
  world: World,
  ctx: SystemContext,
  self: Entity,
  fleer: SettlerIdentity,
  t: Entity,
  firing: ReadonlySet<Entity>,
): boolean {
  const building = world.has(t, Building);
  if (building && !firing.has(t)) return false;
  const vehicle = world.tryGet(t, Vehicle);
  if (vehicle !== undefined && vehicleWeapon(ctx, vehicle) === null) return false;
  if (isValidTarget(world, ctx, self, fleer, t)) return true;
  const selfOwner = world.tryGet(self, Owner);
  const tOwner = world.tryGet(t, Owner);
  if (selfOwner === undefined || tOwner === undefined || selfOwner.player === tOwner.player) return false;
  if (diplomacyStance(world, tOwner.player, selfOwner.player) !== 'enemy') return false;
  if (!world.has(t, Health) || !world.has(t, Position)) return false;
  if (world.get(t, Health).hitpoints <= 0) return false;
  if (building) return true;
  if (!world.has(t, Settler)) return false;
  if (standsAtPost(world, t) !== null) return false;
  return !isManningShelter(world, t);
}

function isAlive(world: World, e: Entity): boolean {
  return (world.tryGet(e, Health)?.hitpoints ?? 0) > 0;
}

/** Whether `t` is huntable prey a hunter of `hunterJob` may strike - the predation-only target filter an
 *  IGNORE hunter uses, which admits no player-hostility. */
export function isHuntTarget(world: World, ctx: SystemContext, t: Entity, hunterJob: number | null): boolean {
  if (!world.has(t, Settler) || !world.has(t, Health) || !world.has(t, Position)) return false;
  if (world.get(t, Health).hitpoints <= 0) return false;
  if (world.has(t, Owner)) return false; // property, not prey - the predation rule of mayTarget below
  return mayHunt(ctx.content, hunterJob, world.get(t, Settler).tribe);
}

/**
 * Whether the attacker entity `self` (of `attackerTribe`/`attackerJob`) may swing at target `t` (of
 * `targetTribe`) - the composed hostility relation both the target-search filter and the attack-order check
 * consult, so autonomous engagement and explicit orders obey the same rule.
 *
 * When both sides carry an {@link Owner} the player axis alone decides, through the directed
 * {@link diplomacyStance} table: the attacker engages only a player it holds an `enemy` stance toward
 * (source basis "Combat hostility axis": the maps' `diplomacy` rows), and a pair no map or command ever
 * set reads `enemy` - itself an approximation on maps that author only one direction of a pair.
 * Otherwise the content relations decide: {@link mayAttack} tribe hostility, {@link mayHunt} predation
 * over unowned prey only (claimed livestock is property), and a live {@link Anger} timer that makes a
 * civ-animal fight valid in both directions.
 *
 * A lapsed anger timer is not reaped here, keeping this a const-time candidate check;
 * {@link hostileAnimalNow} reaps it once per tick on the attacker pass and an expired timer reads
 * not-angry.
 */
export function mayTarget(
  world: World,
  ctx: SystemContext,
  self: Entity,
  attackerTribe: number,
  attackerJob: number | null,
  t: Entity,
  targetTribe: number,
): boolean {
  const selfOwner = world.tryGet(self, Owner);
  const targetOwner = world.tryGet(t, Owner);
  if (selfOwner !== undefined && targetOwner !== undefined) {
    if (selfOwner.player === targetOwner.player) return false;
    return diplomacyStance(world, selfOwner.player, targetOwner.player) === 'enemy';
  }
  // A wild aggressive animal may turn on a player's claimed animal. Wildlife carries no Owner in
  // this sim, so its directed diplomacy stance cannot yet be checked here; this assumes hostility.
  if (
    selfOwner === undefined &&
    targetOwner !== undefined &&
    isAnimalTribe(ctx.content, attackerTribe) &&
    isAnimalTribe(ctx.content, targetTribe) &&
    isAggressiveAnimal(ctx.content, attackerTribe)
  ) {
    return !animalCannotBeAttacked(ctx.content, targetTribe);
  }
  if (mayAttack(ctx.content, attackerTribe, targetTribe)) return true; // static tribe hostility
  // a hunter striking huntable prey, and only unowned prey
  if (targetOwner === undefined && mayHunt(ctx.content, attackerJob, targetTribe)) return true;
  const attackerIsAnimal = isAnimalTribe(ctx.content, attackerTribe);
  const targetIsAnimal = isAnimalTribe(ctx.content, targetTribe);
  // The anger override only bridges a civilization-vs-animal pair - never animal-vs-animal, never civ-vs-civ.
  if (attackerIsAnimal === targetIsAnimal) return false;
  // The animal side of the pair must carry a live anger timer.
  const animalEntity = attackerIsAnimal ? self : t;
  const anger = world.tryGet(animalEntity, Anger);
  return anger !== undefined && ctx.tick < anger.until;
}

/**
 * Whether the animal entity `e` (of `tribe`) is hostile right now - an always-`aggressive` animal, or a
 * passive `getAngry` one that has been provoked and whose {@link Anger} timer is still live. The
 * per-entity layer the content-only {@link mayAttack} cannot carry.
 *
 * Side effect: a lapsed timer is removed here, so the animal reverts to passive and the hash stops
 * accumulating dead timers. Safe on read - the combatant scan visits each entity once per tick.
 */
export function hostileAnimalNow(world: World, ctx: SystemContext, e: Entity, tribe: number): boolean {
  if (isAggressiveAnimal(ctx.content, tribe)) return true; // unconditionally hostile
  const anger = world.tryGet(e, Anger);
  if (anger === undefined) return false; // never provoked
  if (ctx.tick < anger.until) return true; // still angry
  world.remove(e, Anger); // cooled off - revert to passive, reap the stale timer
  return false;
}
