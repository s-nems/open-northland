import {
  Age,
  ANIMAL_FLAG,
  Anger,
  Building,
  Engagement,
  Frightened,
  fightsPlayer,
  Garrison,
  Health,
  hasAnimalFlag,
  isWildlife,
  Owner,
  Palisade,
  Person,
  Position,
  Resting,
  Settler,
  type SettlerIdentity,
  StayPoint,
  Vehicle,
  YoungAnimal,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { isManningShelter, shelterOccupancy, shelterStillHolds } from '../defence/index.js';
import { herdLeaderOf } from '../movement/herd-leader.js';
import { isTravelling } from '../movement/nav-state.js';
import {
  animalCannotBeAttacked,
  buildingCombatClass,
  houseBow,
  isAggressiveAnimal,
  isAnimalTribe,
  isFighterJob,
  isWallBuilding,
  mayAttack,
  mayHunt,
} from '../readviews/index.js';
import { hexNodeDistance } from '../spatial/metric.js';
import { EpochMarks } from './epoch-marks.js';
import { holdsPost, standsAtPost } from './tower-post.js';
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

/** How far from its stay point, in map points, a wild herd leader takes up a target, and how far an angry
 *  attacker walks from it before it lets its target go. Original behavior: on each map point an angry adult
 *  leader walks to its target it looks again for a victim nearer its stay point while within this range, and
 *  past it drops its target and goes back to its stay. A provoked animal whose anger lapsed has no leash: its
 *  attack runs until the target is gone or the walk to it fails. */
export const ANIMAL_ACQUIRE_RANGE_NODES = 40;

/** What an unowned animal's attack drive does this pass: fight `target`, search around `center`, or
 *  nothing. A hold with `retargetAround` also takes a victim nearer that point than `target`. */
export type WildPursuit =
  | { readonly kind: 'hold'; readonly target: Entity; readonly retargetAround?: NodeId }
  | { readonly kind: 'search'; readonly center: NodeId }
  | { readonly kind: 'idle' };

const WILD_IDLE: WildPursuit = { kind: 'idle' };

/**
 * An unowned animal's pursuit this pass. Original behavior: an animal keeps its target while
 * {@link keepsWildTarget} holds; a follower without one does nothing of its own (it takes up its leader's
 * through `rallyFollowers`), and only an adult leader searches, around its stay point and only within
 * {@link ANIMAL_ACQUIRE_RANGE_NODES} of it. A fleeing animal does nothing else. Whether the animal is
 * angry enough to search at all is its caller's gate ({@link hostileAnimalNow}). An angry adult walking to
 * its target answers to its herd ({@link angryWalkerPursuit}).
 */
export function wildPursuit(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  here: NodeId,
): WildPursuit {
  if (world.has(e, Frightened)) return WILD_IDLE;
  const own = world.tryGet(e, Engagement)?.target;
  if (own !== undefined && keepsWildTarget(world, e, own)) {
    const tribe = world.get(e, Settler).tribe;
    if (world.has(e, Age) || !isTravelling(world, e) || !angryAnimal(world, ctx, e, tribe)) {
      return { kind: 'hold', target: own };
    }
    return angryWalkerPursuit(world, terrain, e, here, own);
  }
  if (herdLeaderOf(world, e) !== e || world.has(e, Age)) return WILD_IDLE;
  const stay = world.tryGet(e, StayPoint)?.cell;
  if (stay === undefined) return { kind: 'search', center: here };
  return hexNodeDistance(terrain, here, stay) > ANIMAL_ACQUIRE_RANGE_NODES
    ? WILD_IDLE
    : { kind: 'search', center: stay };
}

/**
 * The pursuit of an angry adult walking to `own`. Original behavior, asked on every map point it reaches: a
 * leader within {@link ANIMAL_ACQUIRE_RANGE_NODES} of its stay point keeps `own` but takes a victim nearer
 * the stay point, and past that range drops `own` to walk back; a follower takes its leader's target, and
 * drops `own` when the leader holds none. Approximation: asked each pass the animal walks.
 */
function angryWalkerPursuit(
  world: World,
  terrain: TerrainGraph,
  e: Entity,
  here: NodeId,
  own: Entity,
): WildPursuit {
  const leader = herdLeaderOf(world, e);
  if (leader === e) {
    const stay = world.tryGet(e, StayPoint)?.cell ?? here;
    return hexNodeDistance(terrain, here, stay) > ANIMAL_ACQUIRE_RANGE_NODES
      ? WILD_IDLE
      : { kind: 'hold', target: own, retargetAround: stay };
  }
  const led = world.tryGet(leader, Engagement)?.target;
  return led !== undefined && keepsWildTarget(world, leader, led) && keepsWildTarget(world, e, led)
    ? { kind: 'hold', target: led }
    : WILD_IDLE;
}

/** Whether the unowned animal `e` presses an attack: it holds a target {@link keepsWildTarget} keeps. The
 *  attack outlasts its anger (original behavior), so it keeps the animal an enemy to those it threatens. */
export function pressesWildAttack(world: World, e: Entity): boolean {
  if (world.has(e, Owner)) return false;
  const target = world.tryGet(e, Engagement)?.target;
  return target !== undefined && keepsWildTarget(world, e, target);
}

/** Whether an unowned animal's attack on `t` goes on. Original behavior: until the target is dead or gone
 *  from the open map, whatever the animal's anger. */
export function keepsWildTarget(world: World, self: Entity, t: Entity): boolean {
  if (t === self || !world.isAlive(t) || !world.has(t, Settler) || !world.has(t, Position)) return false;
  if ((world.tryGet(t, Health)?.hitpoints ?? 0) <= 0) return false;
  if (world.has(t, Resting) || standsAtPost(world, t) !== null) return false;
  return !isManningShelter(world, t);
}

/** Whether animal `e` (of `tribe`) is angry right now without reaping a lapsed timer: an always-aggressive
 *  species, or a provoked one whose {@link Anger} still runs. */
export function angryAnimal(world: World, ctx: SystemContext, e: Entity, tribe: number): boolean {
  if (isAggressiveAnimal(ctx.content, tribe)) return true;
  const anger = world.tryGet(e, Anger);
  return anger !== undefined && ctx.tick < anger.until;
}

/**
 * The tiers a wild herd leader takes up a victim in, first tier first, the nearest to its stay point within
 * each. Original behavior: soldiers and heroes, then angry animals, then the other people, then any other
 * animal. Who is a candidate at all (an adult, of another side, out in the open) is
 * {@link isValidTarget}'s to say; an animal never takes up a building or a vehicle.
 */
export const WILD_VICTIM_TIERS: readonly ((world: World, ctx: SystemContext, t: Entity) => boolean)[] = [
  (world, ctx, t) => isFighterTarget(world, ctx, t),
  (world, ctx, t) => isWildlife(world, t) && angryAnimal(world, ctx, t, world.get(t, Settler).tribe),
  (world, _ctx, t) => world.has(t, Person),
  (world, _ctx, t) => isWildlife(world, t),
];

/** A building, wall or vehicle: a hit on one is an impact on a hull, not a body - no blood, no scream. */
export function isStructureTarget(world: World, t: Entity): boolean {
  return world.has(t, Building) || world.has(t, Palisade) || world.has(t, Vehicle);
}

/** A soldier or hero. */
export function isFighterTarget(world: World, ctx: SystemContext, t: Entity): boolean {
  return world.has(t, Person) && isFighterJob(ctx.content, world.get(t, Settler).jobType);
}

/** Fighters, armed vehicles, towers and actively defending buildings share the first combat priority.
 *  Original behavior: a fighter's first scan takes soldiers and heroes, then catapults, crewed or not, then
 *  headquarters and towers. Owner rule: fighters and towers rank equal. Approximation: an armed vehicle,
 *  ranked between them, joins them, and the headquarters stays in the pick's next tier. */
export function isPriorityCombatTarget(
  world: World,
  ctx: SystemContext,
  t: Entity,
  firing: () => ReadonlySet<Entity>,
): boolean {
  if (isFighterTarget(world, ctx, t)) return true;
  const vehicle = world.tryGet(t, Vehicle);
  if (vehicle !== undefined) return vehicleWeapon(ctx, vehicle) !== null;
  const building = world.tryGet(t, Building);
  return (
    building !== undefined && (buildingCombatClass(ctx, building.buildingType) === 'tower' || firing().has(t))
  );
}

/** Whether a fighter under `order` may turn aside to an enemy of a higher {@link STRIKE_RANK} than its
 *  target and take the target up again afterwards: an assault on a target below the first combat tier,
 *  unless it is a breach, whose breaker stays on its wall (`palisades/breach.ts`). Any other attack order
 *  holds its target through every blow, alarm and enemy in reach, as the original's does; an attack-move
 *  fights the defenders first. Owner rule: the computer's sieges, strikes, raids and leashed defence send
 *  assaults, where the original's computer sends the same plain order and picks each next target itself.
 *  Approximation: in the original a blow whose ordered target is out of reach lands on the last striker in
 *  reach. */
export function turnsAsideUnder(
  world: World,
  ctx: SystemContext,
  order: { readonly target: Entity; readonly breach?: unknown; readonly assault?: true | undefined },
  firing: () => ReadonlySet<Entity>,
): boolean {
  return (
    order.assault === true &&
    order.breach === undefined &&
    !isPriorityCombatTarget(world, ctx, order.target, firing)
  );
}

/** How a fighter ranks the enemies it may turn between, first rank first: the first combat priority
 *  ({@link isPriorityCombatTarget}), then anything else. No retarget leaves a target for one of a lower rank. */
export const STRIKE_RANK = { COMBAT: 0, OTHER: 1 } as const;
export type StrikeRank = (typeof STRIKE_RANK)[keyof typeof STRIKE_RANK];

export function strikeRank(
  world: World,
  ctx: SystemContext,
  t: Entity,
  firing: () => ReadonlySet<Entity>,
): StrikeRank {
  return isPriorityCombatTarget(world, ctx, t, firing) ? STRIKE_RANK.COMBAT : STRIKE_RANK.OTHER;
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
  if (world.has(t, Palisade) || isWallBuilding(world, ctx, t)) return false;
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
  const wallTribe = isWallBuilding(world, ctx, t)
    ? world.get(t, Building).tribe
    : world.tryGet(t, Palisade)?.tribe;
  if (wallTribe !== undefined) {
    if (!world.has(self, Owner) || !world.has(t, Health) || !world.has(t, Position)) return false;
    if (world.get(t, Health).hitpoints <= 0) return false;
    // A map's ownerless wall is anyone's to break; an owned one only an enemy's.
    return (
      !world.has(t, Owner) || mayTarget(world, ctx, self, attacker.tribe, attacker.jobType, t, wallTribe)
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
 * building holding anyone, whose tribe has a house bow. The only buildings a struck civilian runs from.
 */
export function firingBuildings(world: World, ctx: SystemContext): Set<Entity> {
  const firing = new Set<Entity>();
  forEachFiringBuilding(
    world,
    ctx,
    (b) => firing.has(b),
    (b) => {
      firing.add(b);
    },
  );
  return firing;
}

/** {@link firingBuildings} kept in one set across passes: a building that keeps firing stays in it, so a
 *  steady garrison costs no set growth per pass. The set changes in place at each {@link refresh}. */
export class HeldFiringBuildings {
  private readonly firing = new Set<Entity>();
  /** The buildings found firing by the running refresh. */
  private readonly marks = new EpochMarks();
  private readonly marked = (b: Entity): boolean => this.marks.has(b);
  private readonly mark = (b: Entity): void => {
    this.marks.mark(b);
    this.firing.add(b);
  };
  private readonly dropStale = (b: Entity): void => {
    if (!this.marks.has(b)) this.firing.delete(b);
  };

  refresh(world: World, ctx: SystemContext): ReadonlySet<Entity> {
    this.marks.begin();
    forEachFiringBuilding(world, ctx, this.marked, this.mark);
    this.firing.forEach(this.dropStale);
    return this.firing;
  }
}

/** Hand each building able to shoot this tick to `mark` once. `marked` answers whether this sweep already
 *  marked one, so a tower several men stand on is checked for the first of them only. */
function forEachFiringBuilding(
  world: World,
  ctx: SystemContext,
  marked: (b: Entity) => boolean,
  mark: (b: Entity) => void,
): void {
  for (const e of world.query(Garrison)) {
    // A post already marked needs no second man: skip him before reading where he stands.
    if (marked(world.get(e, Garrison).post)) continue;
    const post = standsAtPost(world, e);
    if (post === null || !isAlive(world, e)) continue;
    if (holdsPost(world, ctx, e, post)) mark(post);
  }
  for (const shelter of shelterOccupancy(world).keys()) {
    if (marked(shelter) || !isAlive(world, shelter) || !shelterStillHolds(world, ctx, shelter)) continue;
    if (houseBow(ctx.content, world.get(shelter, Building).tribe) !== undefined) mark(shelter);
  }
}

/**
 * Whether a blow from `t` sends the struck side running: `t` is any valid target of the runner, or - where
 * the directed diplomacy pair is hostile the other way only - a live enemy-stance settler in the open. A
 * building counts either way only while it is among the `firing` ones; a vehicle counts only while armed.
 * Fear staying symmetric on the owner axis while engagement is directed is an approximation, so a pacified
 * player's civilians still run from a one-way aggressor.
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
  if (!fightsPlayer(world, tOwner.player, selfOwner.player)) return false;
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

/** Whether `t` is game a hunter of `hunterJob` takes up on its own - the predation-only target filter an
 *  IGNORE hunter uses, which admits no player-hostility. Original behavior: the search skips owned animals,
 *  one whose map flags say it takes no damage, and an angry one: an adult of an aggressive type, or one
 *  still angry from a provocation. A young animal of an aggressive type is not angry, so it stays game. */
export function isHuntTarget(world: World, ctx: SystemContext, t: Entity, hunterJob: number | null): boolean {
  if (!world.has(t, Settler) || !world.has(t, Health) || !world.has(t, Position)) return false;
  if (world.get(t, Health).hitpoints <= 0) return false;
  if (world.has(t, Owner)) return false; // property, not prey - the predation rule of mayTarget below
  if (hasAnimalFlag(world, t, ANIMAL_FLAG.TAKES_NO_DAMAGE)) return false; // a hunt it would never end
  const tribe = world.get(t, Settler).tribe;
  if (!mayHunt(ctx.content, hunterJob, tribe)) return false;
  if (isAggressiveAnimal(ctx.content, tribe) && !world.has(t, YoungAnimal)) return false;
  const anger = world.tryGet(t, Anger);
  return anger === undefined || ctx.tick >= anger.until;
}

/**
 * Whether the attacker entity `self` (of `attackerTribe`/`attackerJob`) may swing at target `t` (of
 * `targetTribe`) - the composed hostility relation both the target-search filter and the attack-order check
 * consult, so autonomous engagement and explicit orders obey the same rule.
 *
 * When both sides carry an {@link Owner} the player axis alone decides, through the directed
 * {@link fightsPlayer} rule: the attacker engages only a player it holds an `enemy` stance toward (source
 * basis "Combat hostility axis": the maps' `diplomacy` rows) and no lobby peace binds it to, and a pair no
 * map or command ever set reads `enemy` - itself an approximation on maps that author only one direction
 * of a pair.
 * Otherwise the content relations decide: {@link mayAttack} tribe hostility, {@link mayHunt} predation
 * over unowned prey only (claimed livestock is property), and a live {@link Anger} timer or a pressed
 * attack ({@link pressesWildAttack}) that makes a civ-animal fight valid in both directions.
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
  if (world.has(t, Age)) return false;
  const selfOwner = world.tryGet(self, Owner);
  const targetOwner = world.tryGet(t, Owner);
  if (selfOwner !== undefined && targetOwner !== undefined) {
    if (selfOwner.player === targetOwner.player) return false;
    return fightsPlayer(world, selfOwner.player, targetOwner.player);
  }
  // An angry wild animal may turn on a player's animal; original behavior, where wild animals never fight
  // each other. Wildlife carries no Owner in this sim, so its directed diplomacy stance cannot yet be
  // checked here; this assumes hostility.
  if (
    selfOwner === undefined &&
    targetOwner !== undefined &&
    isAnimalTribe(ctx.content, attackerTribe) &&
    isAnimalTribe(ctx.content, targetTribe) &&
    angryAnimal(world, ctx, self, attackerTribe)
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
  // The animal side of the pair must carry a live anger timer, or press an attack its anger outlasted.
  const animalEntity = attackerIsAnimal ? self : t;
  const anger = world.tryGet(animalEntity, Anger);
  return (anger !== undefined && ctx.tick < anger.until) || pressesWildAttack(world, animalEntity);
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
