import {
  AttackOrder,
  Building,
  Carrying,
  CurrentAtomic,
  Engagement,
  Fleeing,
  Health,
  HuntFocus,
  MoveGoal,
  Owner,
  PlayerOrder,
  Position,
  Settler,
  type SettlerIdentity,
  Sheltering,
  Weapon,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { drawsHouseBow, mannedShelter } from '../defence/index.js';
import { isStanding } from '../movement/collision/index.js';
import { withFightDamageBonus } from '../progression/index.js';
import {
  houseBow,
  isAnimalTribe,
  isHunterJob,
  MILITARY_MODE,
  type MilitaryMode,
  weaponDamageVsMaterial,
} from '../readviews/index.js';
import { clearNavState, entityNode, isTravelling } from '../spatial/nodes.js';
import { breakOff, type ChaseTarget, chase, disengage } from './chase.js';
import type { CombatIndex } from './combat-index.js';
import { type CombatantStance, engageSpec, resolveTarget, stanceMode } from './engagement.js';
import { fleeDrive } from './flee.js';
import { holdPrey, preySearchResting, restPreySearch } from './hunting/index.js';
import type { CombatPass } from './pass.js';
import { buildingBodyNodes, combatTargetNode } from './target-node.js';
import { hostileAnimalNow, isValidTarget } from './targeting.js';
import { garrisonReach, standsAtPost, towerPostFor } from './tower-post.js';
import { attackerWeapon, startAttack, targetMaterial } from './weapons.js';

/** The {@link attackerWeapon} resolution: the weapon plus its clamped reach band. */
type ArmedWith = NonNullable<ReturnType<typeof attackerWeapon>>;

/** What a swing reads off its attacker: the content-lookup identity plus the fight-experience buckets. */
type Attacker = SettlerIdentity & { readonly experience: ReadonlyMap<number, number> };

/**
 * Resolve and act on one combatant's engagement this tick: swing, chase, hold a post, flee, or hand back to
 * the economy. The gates below run as a ladder and their order is behavior - each rung shields every rung
 * under it from a case it must not see.
 */
export function engageCombatant(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  pass: CombatPass,
  e: Entity,
): void {
  const { index, seats, slots } = pass;
  const attacker = world.get(e, Settler);
  const posted = attacker.jobType === null ? null : towerPostFor(world, ctx, e, attacker.jobType);
  const manning = posted !== null && standsAtPost(world, e) === posted;
  // Posted but not up there yet: it does not stop to auto-engage on the way, because a swing benches the
  // planner for its whole length and leaves an Engagement, so an archer that opens fire at the foot of its
  // own tower never climbs it. Ahead of the busy gate on purpose - a swing already in flight has to release
  // its Engagement here, or the planner never gets the settler back.
  if (posted !== null && !manning && !world.has(e, AttackOrder)) {
    disengage(world, e);
    return;
  }
  if (busyOrFelled(world, e)) return;
  // An attack-move march is the one player walk that does not bench combat: the unit fights its way there.
  // While its aggression rests (`blockedUntil` - the last chase could not route) it walks as a plain move.
  const march = world.tryGet(e, PlayerOrder)?.attackMove;
  const marching = march !== undefined && ctx.tick >= march.blockedUntil;
  if (suppressedByMoveOrder(world, e, marching)) return;

  const owned = world.has(e, Owner);
  const ordered = liveAttackOrder(world, ctx, e, attacker);
  const manned = mannedShelter(world, e);
  const stance: CombatantStance = {
    owned,
    ordered,
    mode: owned ? actingMode(world, ctx, e, attacker.jobType, marching) : null,
    post: manning ? posted : null,
    // A manned settler always has a seat - `garrisonSeats` numbers every manned claim - so the fallback is
    // only for a claim made after that pass, which reads as the first seat until the next tick.
    shelter: manned === null ? null : { building: manned, seat: seats.get(e) ?? 0 },
  };

  // The two passive stances are overridden by the post, not applied under it: a manned tower is itself the
  // order to hold and shoot, so a garrison neither stands down nor abandons the wall.
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

  const travelling = isTravelling(world, e);
  if (walksUnderAnotherDrive(world, e, travelling, ordered || marching)) return;
  if (standsDownAsPassiveAnimal(world, ctx, e, stance, attacker)) {
    disengage(world, e);
    return;
  }

  const held = attackerWeapon(
    ctx,
    attacker.tribe,
    attacker.jobType,
    wieldedWeaponTypeId(world, ctx, e, stance, attacker),
  );
  if (held === null) {
    disengage(world, e);
    return;
  }
  // The boosted band is what the search, the reach test and the swing all read, so a garrison cannot
  // acquire past what it can actually hit.
  const weapon = stance.post === null ? held : garrisonReach(held);

  if (preySearchResting(world, ctx, e, attacker.jobType, stance)) return;

  // A garrison acquires and measures reach from the tower, not from the door node it stands on inside, so
  // the band it shoots into is the band its arrow leaves from.
  const here = entityNode(world, terrain, stance.shelter?.building ?? e);
  const spec = engageSpec(world, ctx, terrain, index, e, here, stance, attacker, weapon);
  const found = resolveTarget(world, ctx, terrain, pass, e, here, attacker, spec);
  if (found === null) {
    restPreySearch(world, ctx, e, spec);
    breakOff(world, e, here, spec.defend);
    return;
  }

  const { target, dist } = found;
  holdPrey(world, e, spec, target);
  if (inReachAndStanding(dist, weapon, travelling && !arrivedAtGoal(world, e, terrain))) {
    swingAt(world, ctx, e, attacker, owned, target, weapon);
    return;
  }
  if (hasNoAdvanceDrive(ctx, stance, attacker)) {
    disengage(world, e);
    return;
  }
  // Advance on the combat node the reach check measured, so the chase walks toward where the swing lands. A
  // building's full wall list rides along so a chaser whose nearest face is manned encircles to another.
  const chaseTarget: ChaseTarget = {
    entity: target,
    node: combatTargetNode(world, ctx, terrain, here, target),
    body: world.has(target, Building) ? buildingBodyNodes(world, ctx, terrain, target) : null,
  };
  const gaveUp = chase(world, ctx, terrain, slots, e, here, chaseTarget, weapon, stance, spec.defend);
  if (gaveUp) restPreySearch(world, ctx, e, spec);
}

/** The weapon typeId this combatant fights with, overriding its `(tribe, job)` class binding: the house bow
 *  while it mans a shelter, else the {@link Weapon} it carries. `undefined` falls back to the class binding,
 *  which leaves an unarmed civilian unarmed. */
function wieldedWeaponTypeId(
  world: World,
  ctx: SystemContext,
  e: Entity,
  stance: CombatantStance,
  attacker: SettlerIdentity,
): number | undefined {
  if (stance.shelter === null) return world.tryGet(e, Weapon)?.weaponTypeId;
  return drawsHouseBow(world, e) ? houseBow(ctx.content, attacker.tribe)?.typeId : undefined;
}

/** Mid-atomic (a swing or a need plays out), or felled and not yet reaped: no swing from beyond the grave. */
function busyOrFelled(world: World, e: Entity): boolean {
  return world.has(e, CurrentAtomic) || world.get(e, Health).hitpoints <= 0;
}

/** A live player move order suppresses all auto-behavior en route, engage and flee alike; it dies on
 *  arrival, so the unit's own stance takes over at the spot. An attack-move `marching` order is the
 *  exception: the whole point of that walk is to keep fighting along it. */
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

/** Whether an explicit {@link AttackOrder} is in flight, dropping one that has outlived its target first:
 *  left standing, its stale general-hostility spec would fall through the stance dispatch as a one-tick
 *  ATTACK-style re-acquire regardless of the unit's actual stance. */
function liveAttackOrder(world: World, ctx: SystemContext, e: Entity, attacker: SettlerIdentity): boolean {
  if (!world.has(e, AttackOrder)) return false;
  if (isValidTarget(world, ctx, e, attacker, world.get(e, AttackOrder).target)) return true;
  world.remove(e, AttackOrder);
  return false;
}

/** Run the FLEE stance's drive, or shed the flee state of a unit that has stopped fleeing (its stance
 *  changed, or an order took over). Returns whether the flee took the combatant for this tick. */
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
  if (stance.mode !== MILITARY_MODE.FLEE || stance.ordered || world.has(e, Sheltering)) {
    if (world.has(e, Fleeing)) {
      world.remove(e, Fleeing);
      clearNavState(world, e); // drop the run route with the marker
    }
    return false;
  }
  // A fleeing unit is not attack-engaged. A stale marker would outlive the flee, benching the unit and
  // keeping combat awake forever.
  world.remove(e, Engagement);
  world.remove(e, HuntFocus); // and with it the prey hold, which only the hunting branch can reap
  fleeDrive(world, ctx, terrain, index, e, attacker);
  return true;
}

/** The passive stance never auto-engages. A hunter is exempt: its huntable-prey predation is an economic
 *  drive independent of the military mode, so it falls through to the engage path under a predation-only
 *  filter. */
function ignoresCombat(ctx: SystemContext, stance: CombatantStance, attacker: SettlerIdentity): boolean {
  return (
    stance.mode === MILITARY_MODE.IGNORE && !stance.ordered && !isHunterJob(ctx.content, attacker.jobType)
  );
}

/** The carry leg of the one-kill cycle: a loaded hunter banks its kill before any new acquisition. Without
 *  this, the tick after the last pickup - carcass node gone, delivery not yet planned - reads as an idle
 *  hunter and combat steals it mid-cycle. */
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
 *  into combat. An engaged or commanded one is re-evaluated, so a chaser swings the instant it is in reach
 *  and a marching unit acquires without first standing still. */
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

/** Inside the weapon's reach band and standing still. Node positions truncate to the lattice, so a walker
 *  can read as in-band mid-stride and swinging there would freeze it off any node centre, reading as a
 *  glide; gated, it finishes its braked last leg onto the slot's centre first. */
function inReachAndStanding(dist: number, weapon: ArmedWith, moving: boolean): boolean {
  return dist >= weapon.minRange && dist <= weapon.maxRange && !moving;
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

function swingAt(
  world: World,
  ctx: SystemContext,
  e: Entity,
  attacker: Attacker,
  owned: boolean,
  target: Entity,
  weapon: ArmedWith,
): void {
  clearNavState(world, e); // stale-goal hygiene: the unit already stands on its slot's centre
  // The in-band Engagement refresh is owned-only: it matters in the idle tick between swings, where it
  // keeps an owned unit engaged instead of re-tasked. Stamping a swinging unowned civ would only perturb
  // its hash.
  if (owned) world.add(e, Engagement, { repathAt: world.tryGet(e, Engagement)?.repathAt ?? ctx.tick });
  // Fight experience with this weapon class raises the swing's damage (up to +50% at combat mastery).
  const damage = withFightDamageBonus(
    weaponDamageVsMaterial(weapon.weapon, targetMaterial(world, ctx, target)),
    attacker.experience,
    weapon.weapon.mainType,
  );
  startAttack(world, ctx, attacker, e, target, damage, weapon.weapon);
}

/** Who never walks toward a target out of reach: anyone shooting from inside a building, and an unowned
 *  scenario civ. For the men indoors this is where a player's attack order onto something past their reach
 *  dies - {@link resolveTarget} hands the focus back at its real distance, so {@link disengage} lets it go
 *  instead of marching the man out. An owned combatant advances, and so does a hostile wild animal. */
function hasNoAdvanceDrive(ctx: SystemContext, stance: CombatantStance, attacker: SettlerIdentity): boolean {
  if (stance.post !== null || stance.shelter !== null) return true;
  return !stance.owned && !isAnimalTribe(ctx.content, attacker.tribe);
}
