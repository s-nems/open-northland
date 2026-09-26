import {
  AttackOrder,
  Carrying,
  CurrentAtomic,
  Engagement,
  Fleeing,
  Health,
  HuntFocus,
  hasMissionBehaviour,
  MISSION_BEHAVIOUR,
  MoveGoal,
  NeedOrder,
  Owner,
  Palisade,
  PathFollow,
  PathRoute,
  Person,
  PlayerOrder,
  Position,
  Resting,
  removeCurrentAtomic,
  Settler,
  type SettlerIdentity,
  SettlerProgress,
  Sheltering,
  Vehicle,
  Weapon,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { isManningShelter } from '../defence/index.js';
import { isStanding } from '../movement/collision/index.js';
import { clearNavState, isTravelling, redirectRoute } from '../movement/nav-state.js';
import { faceToward } from '../movement/turning.js';
import { weaponClassHits, withFightExperience } from '../progression/index.js';
import {
  isAnimalTribe,
  isFighterJob,
  isHunterJob,
  isRangedWeapon,
  MILITARY_MODE,
  type MilitaryMode,
  stanceFights,
  weaponDamageVsMaterial,
} from '../readviews/index.js';
import { atomicHoldsSettler } from '../settlers/atomics/busy.js';
import { hexNodeDistance } from '../spatial/metric.js';
import { entityNode } from '../spatial/nodes.js';
import { type ApproachBand, breakOff, type ChaseTarget, chase, disengage, REPATH_CADENCE } from './chase.js';
import type { CombatIndex } from './combat-index.js';
import { type CombatantStance, engageSpec, resolveTarget, stanceMode } from './engagement.js';
import { fleeDrive, runsFromBlows, startBlowRun } from './flee.js';
import { breaksHuntForNeed, holdPrey, preySearchResting, restPreySearch } from './hunting/index.js';
import { type MeleeSlots, withinBand } from './melee-slots.js';
import type { CombatPass } from './pass.js';
import { combatTargetNode, targetBodyNodes } from './target-node.js';
import { hostileAnimalNow, isValidOrderedTarget, isValidTarget } from './targeting.js';
import { garrisonReach, standsAtPost, towerPostFor } from './tower-post.js';
import {
  type ArmedWith,
  attackerWeapon,
  hitSoundVsMaterial,
  startAttack,
  targetMaterial,
  wallBlowDamage,
} from './weapons.js';

/**
 * Resolve and act on one combatant's engagement this tick: swing, chase, hold a post, flee, or hand back to
 * the economy. The gates run as a ladder whose order is behavior: each rung shields every rung under it
 * from a case it must not see.
 */
export function engageCombatant(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  pass: CombatPass,
  e: Entity,
): void {
  const { index, slots } = pass;
  const attacker = world.get(e, Settler);
  const posted = attacker.jobType === null ? null : towerPostFor(world, ctx, e, attacker.jobType);
  const manning = posted !== null && standsAtPost(world, e) === posted;
  if (climbingToPost(world, e, posted, manning)) {
    // Released, not merely skipped: a swing already in flight leaves an Engagement the planner would
    // otherwise never get the settler back from.
    disengage(world, e);
    return;
  }
  if (world.get(e, Health).hitpoints <= 0) return; // no swing from beyond the grave
  // A sleeper on duty goes through the search below, which gets it up for a fight; any other atomic holds.
  const dozing = asleepOnDuty(world, e);
  if (!dozing && atomicHoldsSettler(world, e)) return;
  // `blockedUntil` rests an attack-move's aggression after a chase that could not route: it walks as a
  // plain move until then.
  const march = world.tryGet(e, PlayerOrder)?.attackMove;
  const marching = march !== undefined && ctx.tick >= march.blockedUntil;
  if (suppressedByMoveOrder(world, e, marching)) return;

  // Sheltering inside a building on alarm sits the fight out: the building fires for its people
  // (`shelter-fire.ts`), and an order to attack from inside it has nothing to act on.
  if (isManningShelter(world, e)) {
    disengage(world, e);
    return;
  }

  const owned = world.has(e, Owner);
  const mode = owned ? actingMode(world, ctx, e, attacker.jobType, marching) : null;
  const ordered = liveAttackOrder(world, ctx, e, attacker, mode);
  const stance: CombatantStance = { owned, ordered, mode, post: manning ? posted : null };
  // Only a unit that would pick the fight gets up for it - by its stance, or because the player's attack
  // order names the target. A passive or fleeing sleeper sleeps on until a blow lands, which ends any
  // sleep (`atomics/effects/combat/hit/reaction.ts`). A sleep the player ordered is protected further
  // down, where a fight out of the sleeper's own reach no longer rouses it.
  if (dozing && !manning && !ordered && (stance.mode === null || !stanceFights(stance.mode))) return;

  // A script-passive unit neither picks a fight nor runs from one: it stands and takes it, unless a
  // standing attack order names its target (`MISSIONS.md`, behaviour bit 2).
  if (!manning && !ordered && hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.PASSIVE)) {
    disengage(world, e);
    return;
  }
  // A manned post is itself the order to hold and shoot, so neither passive stance applies under one.
  if (!manning) {
    if (resolveFleeState(world, ctx, terrain, index, e, attacker, stance)) return;
    if (ignoresCombat(ctx, stance, attacker)) {
      disengage(world, e);
      return;
    }
  }
  if (carriesKillHome(world, ctx, e, attacker, stance)) {
    disengage(world, e);
    return;
  }
  if (breaksHuntForNeed(world, ctx, e, ordered)) return;

  const travelling = isTravelling(world, e);
  if (walksUnderAnotherDrive(world, e, travelling, ordered || marching)) return;
  if (standsDownAsPassiveAnimal(world, ctx, e, stance, attacker)) {
    disengage(world, e);
    return;
  }

  const held = attackerWeapon(ctx, attacker.tribe, attacker.jobType, world.tryGet(e, Weapon)?.weaponTypeId);
  if (held === null) {
    disengage(world, e);
    return;
  }
  // The boosted band is what the search, the reach test and the swing all read, so a garrison cannot
  // acquire past what it can actually hit.
  const weapon = stance.post === null ? held : garrisonReach(held);

  if (preySearchResting(world, ctx, e, attacker.jobType, stance)) return;

  const here = entityNode(world, terrain, e);
  const spec = engageSpec(world, ctx, terrain, index, e, here, stance, attacker, weapon);
  const moving = travelling && !arrivedAtGoal(world, e, terrain);
  const found = resolveTarget(world, ctx, terrain, pass, e, here, spec, weapon, moving);
  if (found === null) {
    // Nothing to strike yet, but a fight near enough to stand to still gets it up. A guard's walk back to
    // its anchor waits for the next pass.
    if (dozing) {
      if (!orderedToSleep(world, e) && fightNear(world, pass, e)) {
        removeCurrentAtomic(world, e);
      }
      return;
    }
    restPreySearch(world, ctx, e, spec);
    breakOff(world, e, here, spec.defend);
    return;
  }

  const { target, dist } = found;
  if (spec.hold !== undefined) holdTarget(world, ctx, e, target);
  // Woken: the rest already slept keeps, the clip is cut where it stands.
  if (dozing) removeCurrentAtomic(world, e);
  holdPrey(world, e, spec, target);
  if (inReachAndStanding(dist, weapon, moving)) {
    turnToStrike(world, terrain, e, combatTargetNode(world, ctx, terrain, here, target));
    swingAt(world, ctx, e, attacker, owned, target, weapon);
    return;
  }
  if (hasNoAdvanceDrive(ctx, stance, attacker)) {
    disengage(world, e);
    return;
  }
  if (
    moving &&
    withinBand(weapon, dist) &&
    pullUpInReach(world, ctx, terrain, slots, e, here, target, weapon)
  )
    return;
  // Advance on the combat node the reach check measured, so the chase walks toward where the swing lands. A
  // building's full wall list rides along so a chaser whose nearest face is manned encircles to another.
  const chaseTarget: ChaseTarget = {
    entity: target,
    node: combatTargetNode(world, ctx, terrain, here, target),
    body: targetBodyNodes(world, ctx, terrain, target),
  };
  // Only a melee fighter holding a unit forms a front to step along; a besieger encircles its wall instead.
  const front = spec.hold?.contact === true && chaseTarget.body === null ? spec : null;
  const gaveUp = chase(
    world,
    ctx,
    terrain,
    pass,
    e,
    here,
    chaseTarget,
    approachBand(weapon),
    stance,
    spec.defend,
    front,
  );
  if (gaveUp) restPreySearch(world, ctx, e, spec);
}

/** A posted fighter still on its way up. Auto-engaging here would bench the planner for a whole swing, so
 *  an archer that opens fire at the foot of its own tower never climbs it. */
function climbingToPost(world: World, e: Entity, posted: Entity | null, manning: boolean): boolean {
  return posted !== null && !manning && !world.has(e, AttackOrder);
}

/** Asleep in the open or on its tower, where an enemy can reach it; a settler asleep indoors elsewhere is
 *  out of the fight. */
function asleepOnDuty(world: World, e: Entity): boolean {
  if (world.tryGet(e, CurrentAtomic)?.effect.kind !== 'sleep') return false;
  return !world.has(e, Resting) || standsAtPost(world, e) !== null;
}

/** Whether a fight is on close enough to stand to. A sleeper with no target asks this every tick, so it
 *  reads the pass's engaged front rather than scanning the settlement it sleeps in. */
function fightNear(world: World, pass: CombatPass, e: Entity): boolean {
  const player = world.tryGet(e, Owner)?.player;
  if (player === undefined) return false;
  return pass.front.standsTo(e, player);
}

/** Whether the player sent `e` to bed: a fight near it no longer gets it up, only an enemy in its reach. */
function orderedToSleep(world: World, e: Entity): boolean {
  return world.tryGet(e, NeedOrder)?.need === 'fatigue';
}

/** A live player move order suppresses all auto-behavior en route, engage and flee alike; it dies on
 *  arrival. An attack-move `marching` order is the exception - that walk exists to keep fighting along it. */
function suppressedByMoveOrder(world: World, e: Entity, marching: boolean): boolean {
  return !marching && world.has(e, PlayerOrder) && !world.has(e, AttackOrder);
}

/** The mode an owned combatant acts under: its own {@link Stance}, or ATTACK for the duration of an
 *  attack-move march. That override is what attack-move means - a DEFEND guard leaves its anchor and a
 *  civilian stops fleeing until the march ends. */
function actingMode(
  world: World,
  ctx: SystemContext,
  e: Entity,
  jobType: number | null,
  marching: boolean,
): MilitaryMode {
  return marching ? MILITARY_MODE.ATTACK : stanceMode(world, ctx.content, e, jobType);
}

/**
 * Whether the player's {@link AttackOrder} is in flight, dropping one that has outlived its target first:
 * left standing, its stale spec re-acquires ATTACK-style whatever the unit's actual stance says. A fighter's
 * own breach is no player order: it stands only while its wall does, its enemy is still one, and `mode`
 * still advances on enemies.
 */
function liveAttackOrder(
  world: World,
  ctx: SystemContext,
  e: Entity,
  attacker: SettlerIdentity,
  mode: MilitaryMode | null,
): boolean {
  const order = world.tryGet(e, AttackOrder);
  if (order === undefined) return false;
  const breach = order.breach;
  if (breach?.enemy !== undefined) {
    const stands =
      mode === MILITARY_MODE.ATTACK &&
      isValidOrderedTarget(world, ctx, e, attacker, order.target) &&
      isValidTarget(world, ctx, e, attacker, breach.enemy);
    if (!stands) world.remove(e, AttackOrder);
    return false;
  }
  const resume = breach?.resume ?? null;
  // A breach opened for an ordered target lets go once that target is gone.
  if (resume !== null && !isValidOrderedTarget(world, ctx, e, attacker, resume)) {
    world.remove(e, AttackOrder);
    return false;
  }
  if (isValidOrderedTarget(world, ctx, e, attacker, order.target)) return true;
  // A breach whose wall is down goes back to the target it was opened for.
  if (resume !== null) {
    world.add(e, AttackOrder, { target: resume });
    return true;
  }
  world.remove(e, AttackOrder);
  return false;
}

/** Run the FLEE stance's drive, run out the run a blow started under another non-fighting stance, or shed
 *  the flee state of a unit that has stopped fleeing (its stance changed, or an order took over). Returns
 *  whether the run took the combatant for this tick. */
function resolveFleeState(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  index: CombatIndex,
  e: Entity,
  attacker: SettlerIdentity,
  stance: CombatantStance,
): boolean {
  // A settler that has claimed a shelter never flees: the run for cover is its flight. Running would take
  // it back into the open, or abandon the walk it holds a seat for, leaving the building reporting itself
  // full while standing empty.
  const sheltering = stance.ordered || world.has(e, Sheltering);
  if (stance.mode !== MILITARY_MODE.FLEE || sheltering) {
    if (!world.has(e, Fleeing)) return false;
    // The blow's run under IGNORE: the unit finishes it, then hands itself back where it stands. Only the
    // marker owns it meanwhile, so the planner and the hunt leave the runner alone.
    if (!sheltering && stance.mode !== null && runsFromBlows(ctx, attacker, stance.mode)) {
      world.remove(e, Engagement);
      world.remove(e, HuntFocus);
      if (startBlowRun(world, ctx, terrain, e)) return true;
    }
    world.remove(e, Fleeing);
    clearNavState(world, e); // drop the run route with the marker
    return false;
  }
  // A marker outliving the flee would bench the unit and keep combat awake forever.
  world.remove(e, Engagement);
  world.remove(e, HuntFocus); // and with it the prey hold, which only the hunting branch can reap
  fleeDrive(world, ctx, terrain, index, e, attacker);
  return true;
}

/** The passive stance auto-engages only a fighter's in-reach enemies. A hunter is exempt too: predation is
 *  an economic drive independent of the military mode, so it falls through to the engage path under a
 *  predation-only filter. */
function ignoresCombat(ctx: SystemContext, stance: CombatantStance, attacker: SettlerIdentity): boolean {
  return (
    stance.mode === MILITARY_MODE.IGNORE &&
    !stance.ordered &&
    !isHunterJob(ctx.content, attacker.jobType) &&
    !isFighterJob(ctx.content, attacker.jobType)
  );
}

/** The carry leg of the one-kill cycle: a loaded hunter banks its kill before any new acquisition. The tick
 *  after the last pickup - carcass gone, delivery unplanned - would otherwise read as an idle hunter. */
function carriesKillHome(
  world: World,
  ctx: SystemContext,
  e: Entity,
  attacker: SettlerIdentity,
  stance: CombatantStance,
): boolean {
  return !stance.ordered && isHunterJob(ctx.content, attacker.jobType) && world.has(e, Carrying);
}

/** A travelling unit that is neither engaged nor commanded walks under another drive and must not be yanked
 *  into combat. The engaged and commanded are re-evaluated, so they acquire without first standing still. */
function walksUnderAnotherDrive(world: World, e: Entity, travelling: boolean, commanded: boolean): boolean {
  return travelling && !world.has(e, Engagement) && !commanded;
}

/** An unowned animal that is neither aggressive nor still provoked runs no attack drive. Reaps a lapsed
 *  {@link Anger} timer as it reads it. */
function standsDownAsPassiveAnimal(
  world: World,
  ctx: SystemContext,
  e: Entity,
  stance: CombatantStance,
  attacker: SettlerIdentity,
): boolean {
  if (stance.owned || stance.ordered || !isAnimalTribe(ctx.content, attacker.tribe)) return false;
  return !hostileAnimalNow(world, ctx, e, attacker.tribe);
}

/**
 * Stop a walker that has come into reach of its target: on the stop it is walking toward when its target is
 * still in reach from there, else back on the node it is crossing, whichever no body holds. It arrives,
 * stands and strikes. Original behavior: an attacker walks up step by step and strikes once its target is in
 * reach. Without this a chaser walks on to the contact cell it was dealt at its last re-path, which a target
 * walking toward it has already passed. Answers whether the walk now ends in reach.
 */
function pullUpInReach(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  slots: MeleeSlots,
  e: Entity,
  here: NodeId,
  target: Entity,
  weapon: ArmedWith,
): boolean {
  const follow = world.tryGet(e, PathFollow);
  const stop = follow === undefined ? undefined : world.tryGet(e, PathRoute)?.waypoints[follow.index]?.node;
  const goal = world.tryGet(e, MoveGoal)?.cell;
  for (const cell of stop === undefined ? [here] : [stop, here]) {
    if (
      !withinBand(weapon, hexNodeDistance(terrain, cell, combatTargetNode(world, ctx, terrain, cell, target)))
    )
      continue;
    // A body can step onto the goal ahead of it, and two never share a node.
    if (slots.isOccupied(cell)) continue;
    if (cell === goal) return true; // already walking there
    redirectRoute(world, e, cell);
    slots.claim(cell, world.tryGet(e, Owner)?.player ?? null);
    const engagement = world.tryMut(e, Engagement);
    if (engagement !== undefined) engagement.repathAt = ctx.tick + REPATH_CADENCE;
    return true;
  }
  return false;
}

/** Inside the weapon's reach band and standing still. Node positions truncate to the lattice, so a walker
 *  can read as in-band mid-stride and swinging there would freeze it off any node centre, reading as a
 *  glide; gated, it finishes its braked last leg onto the slot's centre first. */
function inReachAndStanding(dist: number, weapon: ArmedWith, moving: boolean): boolean {
  return withinBand(weapon, dist) && !moving;
}

/** Whether `e` is route-free and standing on the exact centre of the goal it still carries - the remnant
 *  between a walk ending and next tick's planner retiring the goal, which is not motion. The centre test is
 *  the planner's own; the truncated node alone would also admit a walker parked half a node off centre. */
function arrivedAtGoal(world: World, e: Entity, terrain: TerrainGraph): boolean {
  const goal = world.tryGet(e, MoveGoal)?.cell;
  if (goal === undefined || !isStanding(world, e)) return false;
  const g = terrain.coordsOf(goal);
  const centre = positionOfNode(g.x, g.y);
  const p = world.get(e, Position);
  return p.x === centre.x && p.y === centre.y;
}

/** A person turns to the node it strikes, the facing a blow landing on it later reads for its direction.
 *  Wildlife carries no facing. */
function turnToStrike(world: World, terrain: TerrainGraph, e: Entity, targetNode: NodeId): void {
  if (!world.has(e, Person)) return;
  const toward = positionOfNode(terrain.xOf(targetNode), terrain.yOf(targetNode));
  faceToward(world, e, world.get(e, Position), toward);
}

function swingAt(
  world: World,
  ctx: SystemContext,
  e: Entity,
  attacker: SettlerIdentity,
  owned: boolean,
  target: Entity,
  weapon: ArmedWith,
): void {
  clearNavState(world, e); // stale-goal hygiene: the unit already stands on its slot's centre
  // The in-band Engagement refresh is owned-only: it matters in the idle tick between swings, where it
  // keeps an owned unit engaged instead of re-tasked. Stamping a swinging unowned civ would only perturb
  // its hash.
  if (owned) {
    const prior = world.tryGet(e, Engagement);
    if (prior === undefined) world.add(e, Engagement, { repathAt: ctx.tick });
    else if (prior.stall !== undefined) world.mut(e, Engagement).stall = undefined; // it reached its target
  }
  // The victim's armor material selects both the damage column and the impact sound, and fight experience
  // with this weapon class raises the column. Original behavior: a wall and a vehicle take the bare column,
  // unscaled by experience. A ranged swing's shot resolves the column again, without the experience,
  // against whatever it strikes.
  const material = targetMaterial(world, ctx, target);
  const base = weaponDamageVsMaterial(weapon.weapon, material);
  const hits = weaponClassHits(world.get(e, SettlerProgress).experience, weapon.weapon.mainType);
  let damage = withFightExperience(base, hits);
  if (world.has(target, Palisade)) damage = wallBlowDamage(base);
  else if (world.has(target, Vehicle)) damage = base;
  const blow = { damage, hitSoundType: hitSoundVsMaterial(weapon.weapon, material) };
  startAttack(world, ctx, attacker, e, target, blow, weapon.weapon);
}

/**
 * The band a chaser closes into: a melee weapon's whole reach, where it takes a contact slot, and a ranged
 * one's reach cut back to the standoff `(2 * max - min) / 2`, so an archer steps in past its farthest shot.
 * Original behavior.
 */
function approachBand(weapon: ArmedWith): ApproachBand {
  const { minRange, maxRange } = weapon;
  if (!isRangedWeapon(weapon.weapon)) return { minRange, maxRange, contact: true };
  if (minRange >= maxRange) return { minRange, maxRange, contact: false };
  return { minRange, maxRange: (2 * maxRange - minRange) >> 1, contact: false };
}

/** Remember `target` as the enemy `e` holds, written only when it changes. */
function holdTarget(world: World, ctx: SystemContext, e: Entity, target: Entity): void {
  const engagement = world.tryGet(e, Engagement);
  if (engagement === undefined) world.add(e, Engagement, { repathAt: ctx.tick, target });
  else if (engagement.target !== target) world.mut(e, Engagement).target = target;
}

/** Who never walks toward a target out of reach: a garrison shooting from its tower, and an unowned
 *  scenario civ. For the men on a tower this is also where an attack order onto something past their reach
 *  dies, rather than marching them down. An owned combatant advances, and so does a hostile wild animal. */
function hasNoAdvanceDrive(ctx: SystemContext, stance: CombatantStance, attacker: SettlerIdentity): boolean {
  if (stance.post !== null) return true;
  return !stance.owned && !isAnimalTribe(ctx.content, attacker.tribe);
}
