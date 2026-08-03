import {
  AttackOrder,
  Building,
  Carrying,
  CurrentAtomic,
  Engagement,
  Fleeing,
  Health,
  HuntFocus,
  HuntRest,
  MoveGoal,
  Owner,
  PlayerOrder,
  Position,
  Settler,
  type SettlerIdentity,
  Weapon,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { isStanding } from '../movement/collision/index.js';
import { withFightDamageBonus } from '../progression/index.js';
import {
  isAnimalTribe,
  isHunterJob,
  MILITARY_MODE,
  type MilitaryMode,
  weaponDamageVsMaterial,
} from '../readviews/index.js';
import { clearNavState, entityNode, isTravelling, type NodeBuckets } from '../spatial/nodes.js';
import { breakOff, type ChaseTarget, chase, disengage } from './chase.js';
import { type CombatantStance, engageSpec, resolveTarget, stanceMode } from './engagement.js';
import { fleeDrive } from './flee.js';
import { HUNT_SEARCH_REST_TICKS, holdPrey } from './hunting/index.js';
import type { MeleeSlots } from './melee-slots.js';
import type { HostilePresence } from './presence.js';
import { type BuildingBodyNodeCache, buildingBodyNodes, combatTargetNode } from './target-node.js';
import { hostileAnimalNow, isValidTarget } from './targeting.js';
import { garrisonReach, standsAtPost, towerPostFor } from './tower-post.js';
import { attackerWeapon, startAttack, targetMaterial } from './weapons.js';

/** What a combatant fights with: the {@link attackerWeapon} resolution, weapon plus clamped reach band. */
type ArmedWith = NonNullable<ReturnType<typeof attackerWeapon>>;

/** What a swing reads off its attacker: the content-lookup identity plus the fight-experience buckets. */
type Attacker = SettlerIdentity & { readonly experience: ReadonlyMap<number, number> };

/**
 * Resolve and act on one combatant's engagement this tick: swing, chase, hold a post, flee, or hand back to
 * the economy. The gates below run as a ladder and their order is behavior: each rung shields every rung
 * under it from a case it must not see (a travelling passive animal returns above the Anger reap, not
 * through it).
 */
export function engageCombatant(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  index: NodeBuckets,
  presence: HostilePresence,
  slots: MeleeSlots,
  bodyNodes: BuildingBodyNodeCache,
  e: Entity,
): void {
  const attacker = world.get(e, Settler);
  // The tower post this settler is assigned to (null for everyone else), and whether it is standing on it.
  const posted = attacker.jobType === null ? null : towerPostFor(world, ctx, e, attacker.jobType);
  const manning = posted !== null && standsAtPost(world, e) === posted;
  // Posted but not up there yet - on the road to its post, or walking back from a meal. It does not stop
  // to auto-engage on the way: a swing benches the planner for its whole length AND leaves an Engagement
  // that the ladder's ownership gate reads, so an archer that opens fire at the foot of its own tower never
  // climbs it. Ahead of the busy gate on purpose - a swing already in flight has to release its Engagement
  // here, or the planner never gets the settler back. An explicit attack order overrides.
  if (posted !== null && !manning && !world.has(e, AttackOrder)) {
    disengage(world, e);
    return;
  }
  if (busyOrFelled(world, e)) return;
  // An attack-move march is the one player walk that does NOT bench combat: the unit fights its way there.
  // While its aggression rests (`blockedUntil` - the last chase could not route) it walks as a plain move.
  const march = world.tryGet(e, PlayerOrder)?.attackMove;
  const marching = march !== undefined && ctx.tick >= march.blockedUntil;
  if (suppressedByMoveOrder(world, e, marching)) return;

  const owned = world.has(e, Owner);
  const ordered = liveAttackOrder(world, ctx, e, attacker);
  const stance: CombatantStance = {
    owned,
    ordered,
    mode: owned ? actingMode(world, ctx, e, attacker.jobType, marching) : null,
    post: manning ? posted : null,
  };

  // The two PASSIVE stances are overridden by the post, not applied under it: a manned tower IS the order
  // to hold and shoot, so a garrison neither stands down (IGNORE) nor abandons the wall (FLEE).
  if (!manning) {
    if (resolveFleeState(world, ctx, terrain, index, presence, e, attacker, stance)) return;
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

  const held = attackerWeapon(ctx, attacker.tribe, attacker.jobType, world.tryGet(e, Weapon)?.weaponTypeId);
  if (held === null) {
    disengage(world, e);
    return;
  }
  // Manning a tower extends the bow's reach and drops its near dead zone (./tower-post.ts). The boosted band
  // is what the search, the reach test and the swing all read, so a garrison cannot acquire past what it
  // can actually hit.
  const weapon = stance.post === null ? held : garrisonReach(held);

  if (huntSearchRests(world, ctx, e, attacker, stance)) return;

  const here = entityNode(world, terrain, e);
  const spec = engageSpec(world, ctx, terrain, index, e, stance, attacker, weapon);
  const found = resolveTarget(world, ctx, terrain, index, presence, e, here, attacker, spec, bodyNodes);
  if (found === null) {
    // A hunting hunter's empty search rests the acquisition (HuntRest). Not under a DEFEND post: there
    // the band is small and a rest would also skip the walk-back retry below for its duration.
    if (isHunterJob(ctx.content, attacker.jobType) && spec.defend?.hold !== true && !world.has(e, HuntRest)) {
      world.add(e, HuntRest, { until: ctx.tick + HUNT_SEARCH_REST_TICKS });
    }
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
  // Advance on the combat node the reach check measured - its own node for a unit, its nearest wall cell for
  // a building - so the chase walks toward where the swing lands. A building's full wall list rides along so
  // a chaser whose nearest face is manned encircles to another.
  const chaseTarget: ChaseTarget = {
    entity: target,
    node: combatTargetNode(world, ctx, terrain, here, target, bodyNodes),
    body: world.has(target, Building) ? buildingBodyNodes(world, ctx, terrain, target, bodyNodes) : null,
  };
  chase(world, ctx, terrain, slots, e, here, chaseTarget, weapon, stance, spec.defend);
}

/** Mid-atomic (a swing or a need plays out), or felled and not yet reaped: no swing from beyond the grave. */
function busyOrFelled(world: World, e: Entity): boolean {
  return world.has(e, CurrentAtomic) || world.get(e, Health).hitpoints <= 0;
}

/** A live player move order (a {@link PlayerOrder} that is not an {@link AttackOrder}) suppresses ALL
 *  auto-behavior en route - engage and flee alike, the reposition is authoritative. It dies on arrival, so
 *  the unit's own stance takes over at the spot. An attack-move `marching` order is the exception: the whole
 *  point of that walk is to keep fighting along it. */
function suppressedByMoveOrder(world: World, e: Entity, marching: boolean): boolean {
  return !marching && world.has(e, PlayerOrder) && !world.has(e, AttackOrder);
}

/** The mode an OWNED combatant acts under: its own {@link Stance} ({@link stanceMode}) - or ATTACK for the
 *  duration of an attack-move march, whatever its stance says. That override IS attack-move: a DEFEND guard
 *  leaves its anchor, a scout stops ignoring, a civilian stops fleeing, all until the march ends. */
function actingMode(
  world: World,
  ctx: SystemContext,
  e: Entity,
  jobType: number | null,
  marching: boolean,
): MilitaryMode {
  return marching ? MILITARY_MODE.ATTACK : stanceMode(world, ctx.content, e, jobType);
}

/** Whether an explicit {@link AttackOrder} is in flight, dropping one that has outlived its target (dead, or
 *  no longer a valid hostile) first: left standing, its stale general-hostility spec would fall through the
 *  stance dispatch below as a one-tick ATTACK-style re-acquire regardless of the unit's actual stance. */
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
  index: NodeBuckets,
  presence: HostilePresence,
  e: Entity,
  attacker: SettlerIdentity,
  stance: CombatantStance,
): boolean {
  if (stance.mode !== MILITARY_MODE.FLEE || stance.ordered) {
    if (world.has(e, Fleeing)) {
      world.remove(e, Fleeing);
      clearNavState(world, e); // drop the run route with the marker
    }
    return false;
  }
  // A fleeing unit is not attack-engaged: shed any Engagement left from a prior ATTACK/DEFEND chase. A stale
  // marker would outlive the flee - `fleeDrive` drops `Fleeing` but not `Engagement` - benching the unit
  // (plannerSystem skips it) and keeping combat awake forever.
  world.remove(e, Engagement);
  world.remove(e, HuntFocus); // and with it the prey hold, which only the hunting branch can reap
  fleeDrive(world, ctx, terrain, index, presence, e, attacker);
  return true;
}

/** The passive stance (IGNORE, and the unset NONE {@link stanceMode} normalizes to it) never auto-engages.
 *  A hunter is exempt: its huntable-prey predation is an economic drive independent of the military mode,
 *  so it falls through to the engage path under a predation-only filter ({@link engageSpec}). */
function ignoresCombat(ctx: SystemContext, stance: CombatantStance, attacker: SettlerIdentity): boolean {
  return (
    stance.mode === MILITARY_MODE.IGNORE && !stance.ordered && !isHunterJob(ctx.content, attacker.jobType)
  );
}

/** The carry leg of the one-kill cycle (`hunterEngageSpec` owns the rule): a loaded hunter banks its
 *  kill before any new acquisition. Without this, the tick after the LAST pickup (carcass node gone,
 *  delivery not yet planned) reads as an idle hunter and combat steals it mid-cycle. Hunter-scoped and
 *  stance-wide; only an explicit player attack order pierces it, like every rung here. */
function carriesKillHome(
  world: World,
  ctx: SystemContext,
  e: Entity,
  attacker: SettlerIdentity,
  stance: CombatantStance,
): boolean {
  return !stance.ordered && isHunterJob(ctx.content, attacker.jobType) && world.has(e, Carrying);
}

/** Whether a resting hunter ({@link HuntRest} - the empty-search breather) skips this tick's acquisition.
 *  Reaps a lapsed rest as it reads it. Never rests an ordered focus or a live chase: the order rung
 *  bypasses the ring search anyway, and an Engagement must keep re-resolving every tick so the chaser
 *  swings the instant it is in reach. */
function huntSearchRests(
  world: World,
  ctx: SystemContext,
  e: Entity,
  attacker: SettlerIdentity,
  stance: CombatantStance,
): boolean {
  if (!isHunterJob(ctx.content, attacker.jobType)) return false;
  if (stance.ordered || world.has(e, Engagement)) return false;
  const rest = world.tryGet(e, HuntRest);
  if (rest === undefined) return false;
  if (ctx.tick < rest.until) return true;
  world.remove(e, HuntRest);
  return false;
}

/** A travelling unit that is neither engaged nor commanded walks under another drive (an economy walk, or a
 *  DEFEND unit heading back to its anchor) - don't yank it into combat. An engaged or commanded one (an
 *  {@link AttackOrder} focus, an attack-move march) IS re-evaluated, so a chaser stops and swings the instant
 *  it is in reach and a marching unit acquires without first standing still. */
function walksUnderAnotherDrive(world: World, e: Entity, travelling: boolean, commanded: boolean): boolean {
  return travelling && !world.has(e, Engagement) && !commanded;
}

/** An unowned animal that is neither aggressive nor still provoked runs no attack drive (an owned unit is
 *  always an aggressor). Reaps a lapsed {@link Anger} timer as it reads it ({@link hostileAnimalNow}). */
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

/** Inside the weapon's reach band AND standing still. The standstill gate: node positions truncate to the
 *  lattice (`nodeOfPosition`), so a walker can read as in-band mid-stride (up to half an edge short of a
 *  centre) and swinging there would freeze it off any node centre, reading as a glide. Gated, the walker
 *  finishes its braked last leg onto the slot's centre first. */
function inReachAndStanding(dist: number, weapon: ArmedWith, moving: boolean): boolean {
  return dist >= weapon.minRange && dist <= weapon.maxRange && !moving;
}

/** Whether `e` is route-free ({@link isStanding}) and standing on the exact centre of the goal it still
 *  carries - the remnant between a walk ending and next tick's navigation planner retiring the goal, which is
 *  not motion. The centre test is the planner's own (`planner/navigation.ts`), so this means precisely "that
 *  goal is retired next tick"; the truncated node alone would also admit a walker parked up to half a node
 *  off centre, and swinging there is the glide {@link inReachAndStanding} exists to prevent. */
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
  // The in-band Engagement refresh (economy-skip + chase throttle) is owned-only: it matters in the idle
  // tick between swings (mid-swing, `CurrentAtomic` already gates the unit off the economy), where it keeps
  // an owned unit engaged instead of re-tasked. An advancing animal picks its Engagement up from chase();
  // stamping a swinging unowned civ would only perturb its hash.
  if (owned) world.add(e, Engagement, { repathAt: world.tryGet(e, Engagement)?.repathAt ?? ctx.tick });
  // Fight experience with this weapon class raises the swing's damage (up to +50% at combat mastery).
  const damage = withFightDamageBonus(
    weaponDamageVsMaterial(weapon.weapon, targetMaterial(world, ctx, target)),
    attacker.experience,
    weapon.weapon.mainType,
  );
  startAttack(world, ctx, attacker, e, target, damage, weapon.weapon);
}

/** Who never walks toward a target out of reach: a GARRISON (a wall may not be abandoned to chase) and an
 *  unowned scenario CIV. For a garrison this is where the player's attack order onto something past the
 *  tower's reach dies: {@link resolveTarget} hands a focus back at its REAL distance, uncapped by the search
 *  band, so the order arrives here and {@link disengage} lets it go instead of marching the man out. An
 *  owned combatant advances, and so does a hostile wild animal (the wolf's ambush lunge, the provoked bear's
 *  charge - {@link resolveTarget} only admits a victim inside its aggro radius). */
function hasNoAdvanceDrive(ctx: SystemContext, stance: CombatantStance, attacker: SettlerIdentity): boolean {
  if (stance.post !== null) return true;
  return !stance.owned && !isAnimalTribe(ctx.content, attacker.tribe);
}
