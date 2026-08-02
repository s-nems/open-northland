import {
  AttackOrder,
  Building,
  Carrying,
  CurrentAtomic,
  Engagement,
  Fleeing,
  Health,
  HuntRest,
  Owner,
  PlayerOrder,
  Settler,
  type SettlerIdentity,
  Weapon,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { withFightDamageBonus } from '../progression/index.js';
import { isAnimalTribe, isHunterJob, MILITARY_MODE, weaponDamageVsMaterial } from '../readviews/index.js';
import { clearNavState, entityNode, isTravelling, type NodeBuckets } from '../spatial/nodes.js';
import { type ChaseTarget, chase, disengage, returnToAnchor } from './chase.js';
import { type CombatantStance, engageSpec, resolveTarget, stanceMode } from './engagement.js';
import { fleeDrive } from './flee.js';
import { HUNT_SEARCH_REST_TICKS } from './hunting-ground.js';
import type { MeleeSlots } from './melee-slots.js';
import type { HostilePresence } from './presence.js';
import { type BuildingBodyNodeCache, buildingBodyNodes, combatTargetNode } from './target-node.js';
import { hostileAnimalNow, isValidTarget } from './targeting.js';
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
  if (busyOrFelled(world, e)) return;
  if (suppressedByMoveOrder(world, e)) return;

  const attacker = world.get(e, Settler);
  const owned = world.has(e, Owner);
  const ordered = liveAttackOrder(world, ctx, e, attacker);
  const stance: CombatantStance = {
    owned,
    ordered,
    mode: owned ? stanceMode(world, ctx.content, e, attacker.jobType) : null,
  };

  if (resolveFleeState(world, ctx, terrain, index, presence, e, attacker, stance)) return;
  if (ignoresCombat(ctx, stance, attacker)) {
    disengage(world, e);
    return;
  }
  if (carriesKillHome(world, ctx, e, attacker, stance)) {
    disengage(world, e);
    return;
  }

  const travelling = isTravelling(world, e);
  if (walksUnderAnotherDrive(world, e, travelling, ordered)) return;
  if (standsDownAsPassiveAnimal(world, ctx, e, stance, attacker)) {
    disengage(world, e);
    return;
  }

  const weapon = attackerWeapon(ctx, attacker.tribe, attacker.jobType, world.tryGet(e, Weapon)?.weaponTypeId);
  if (weapon === null) {
    disengage(world, e);
    return;
  }

  if (huntSearchRests(world, ctx, e, attacker, stance)) return;

  const here = entityNode(world, terrain, e);
  const spec = engageSpec(world, ctx, terrain, e, stance, attacker, weapon);
  const found = resolveTarget(world, ctx, terrain, index, presence, e, here, attacker, spec, bodyNodes);
  if (found === null) {
    // A hunting hunter's empty search rests the acquisition (HuntRest). Not under a DEFEND post: there
    // the band is small and a rest would also skip the walk-back retry below for its duration.
    if (isHunterJob(ctx.content, attacker.jobType) && spec.defend?.hold !== true && !world.has(e, HuntRest)) {
      world.add(e, HuntRest, { until: ctx.tick + HUNT_SEARCH_REST_TICKS });
    }
    // A DEFEND unit (`defend.hold`) walks back and holds its post when nothing is in its radius;
    // everyone else - including a hunter between hunts - returns to the economy.
    if (spec.defend?.hold) returnToAnchor(world, e, here, spec.defend.anchorCell);
    else disengage(world, e);
    return;
  }

  const { target, dist } = found;
  if (inReachAndStanding(dist, weapon, travelling)) {
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
 *  the unit's own stance takes over at the spot. */
function suppressedByMoveOrder(world: World, e: Entity): boolean {
  return world.has(e, PlayerOrder) && !world.has(e, AttackOrder);
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

/** A travelling unit that is neither engaged nor ordered walks under another drive (an economy walk, or a
 *  DEFEND unit heading back to its anchor) - don't yank it into combat. An engaged or ordered one IS
 *  re-evaluated, so a chaser stops and swings the instant it is in reach. */
function walksUnderAnotherDrive(world: World, e: Entity, travelling: boolean, ordered: boolean): boolean {
  return travelling && !world.has(e, Engagement) && !ordered;
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
function inReachAndStanding(dist: number, weapon: ArmedWith, travelling: boolean): boolean {
  return dist >= weapon.minRange && dist <= weapon.maxRange && !travelling;
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

/** An unowned scenario CIV keeps the swing-in-place read and never advances on a target out of reach: its
 *  search radius was capped at `maxRange`, so this is unreachable - kept explicit rather than assumed away.
 *  An owned combatant advances, and so does a hostile wild animal (the wolf's ambush lunge, the provoked
 *  bear's charge - {@link resolveTarget} only admits a victim inside its aggro radius). */
function hasNoAdvanceDrive(ctx: SystemContext, stance: CombatantStance, attacker: SettlerIdentity): boolean {
  return !stance.owned && !isAnimalTribe(ctx.content, attacker.tribe);
}
