import type { ContentSet } from '@open-northland/data';
import {
  Anger,
  AttackOrder,
  CurrentAtomic,
  Engagement,
  Fleeing,
  Garrison,
  Health,
  HuntFocus,
  isValidPlayer,
  MoveGoal,
  Owner,
  PathFollow,
  PathRequest,
  PathRoute,
  PlayerOrder,
  Position,
  Resting,
  Settler,
  Stance,
  Stranded,
  UnreachableTargets,
  Weapon,
} from '../../components/index.js';
import type { Component, Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { isTravelling } from '../movement/nav-state.js';
import {
  isAggressiveAnimal,
  isAnimalTribe,
  isFighterJob,
  isHunterJob,
  MILITARY_MODE,
  type MilitaryMode,
  stanceMode,
} from '../readviews/index.js';
import { atomicHoldsSettler } from '../settlers/atomics/busy.js';
import { entityNode } from '../spatial/nodes.js';
import { guardPost } from './chase.js';
import type { CombatIndex } from './combat-index.js';
import { asleepOnDuty } from './engage-combatant.js';
import { DEFEND_RADIUS_NODES } from './engagement.js';
import { ANIMAL_AGGRO_RADIUS_NODES, SIGHT_RADIUS_NODES, wildPursuit } from './targeting.js';
import { mannedPostOf, TOWER_RANGE_BONUS_NODES } from './tower-post.js';
import { attackerWeapon } from './weapons.js';

/**
 * Whether `e` may act in this combat pass. False proves `engageCombatant` would leave it with no write and
 * no draw: every rung it reaches either returns or drops state it does not hold, and the target search
 * finds nothing. Asked in the pass's own order, so it reads each unit as the ladder would. `nearStranger`
 * false says the index's `unitsNearStrangers` did not list `e` within {@link PRESENCE_RADIUS} and it does not
 * {@link searchesPastPresence}, so an owned unit in a player slot fails every presence test without asking it.
 */
export function mayEngage(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  index: CombatIndex,
  e: Entity,
  nearStranger = true,
): boolean {
  if (holdsLadderState(world, e)) return true;
  // A sleeper in the open reads the battle front; any other clip holds its settler out of the pass.
  if (asleepOnDuty(world, e)) return true;
  if (atomicHoldsSettler(world, e)) return false;
  // A plain move order benches the unit, and so does an attack-move resting after a refused chase.
  const order = world.tryGet(e, PlayerOrder);
  const march = order?.attackMove;
  if (order !== undefined && (march === undefined || ctx.tick < march.blockedUntil)) return false;
  const marching = order !== undefined;
  const settler = world.get(e, Settler);
  // A hunter's prey search is never presence-gated, and it keeps its own rest and lock.
  if (isHunterJob(ctx.content, settler.jobType)) return true;
  const garrisoned = world.has(e, Garrison);
  const owner = world.tryGet(e, Owner);
  if (garrisoned && owner === undefined) return true;
  // An attack-move march acts under ATTACK whatever its stance, as the ladder's own acting mode does.
  const mode =
    owner === undefined
      ? null
      : marching
        ? MILITARY_MODE.ATTACK
        : stanceMode(world, ctx.content, e, settler.jobType);
  // Only a march runs ahead of the rung that leaves a walker to the drive that sent it.
  if (!marching && isTravelling(world, e)) return false;
  const here = entityNode(world, terrain, e);
  if (owner === undefined || mode === null) {
    if (!isAnimalTribe(ctx.content, settler.tribe)) return true; // a scenario civ's search is ungated
    // A passive animal stands down; a provoked one holds Anger.
    if (!isAggressiveAnimal(ctx.content, settler.tribe)) return false;
    const pursuit = wildPursuit(world, ctx, terrain, e, here);
    if (pursuit.kind !== 'search') return pursuit.kind !== 'idle';
    const { center } = pursuit;
    return index.civsWithin(terrain.xOf(center), terrain.yOf(center), ANIMAL_AGGRO_RADIUS_NODES);
  }
  if (!nearStranger && isValidPlayer(owner.player)) {
    // Every search below finds nothing, so only a guard off its anchor acts, and not from a manned post.
    if (!guardsAnchor(ctx.content, mode, settler.jobType) || !awayFromAnchor(world, ctx, terrain, e, here))
      return false;
    return !garrisoned || mannedPostOf(world, ctx, e) === null;
  }
  const x = terrain.xOf(here);
  const y = terrain.yOf(here);
  // A manned post searches its weapon's reach raised by the tower, and neither flees nor walks back.
  if (garrisoned && mannedPostOf(world, ctx, e) !== null) {
    return index.othersWithin(owner.player, x, y, reachOf(world, ctx, e) + TOWER_RANGE_BONUS_NODES);
  }
  // Every owned search stays inside this, bar a guard's search further out.
  let radius = PRESENCE_RADIUS;
  const reachGuard = mode === MILITARY_MODE.IGNORE && isFighterJob(ctx.content, settler.jobType);
  if (guardsAnchor(ctx.content, mode, settler.jobType)) {
    // With nothing to fight, a guard walks back to its anchor and drops its route state.
    if (awayFromAnchor(world, ctx, terrain, e, here)) return true;
    if (reachGuard) radius = Math.max(radius, reachOf(world, ctx, e));
  }
  return index.othersWithin(owner.player, x, y, radius);
}

/** The stores whose membership, or whose values for {@link READY_VALUES}, can flip {@link readyAnywhere}.
 *  A job change arrives through the settler trade log instead of a Settler value feed. */
export const READY_MEMBERSHIP: readonly Component<unknown>[] = [
  Settler,
  Health,
  Position,
  Owner,
  Engagement,
  AttackOrder,
  Anger,
  Fleeing,
  HuntFocus,
  UnreachableTargets,
  Garrison,
  Stance,
  CurrentAtomic,
  Resting,
  MoveGoal,
  PathRequest,
  PathFollow,
  PathRoute,
  Stranded,
];
export const READY_VALUES: readonly Component<unknown>[] = [Owner, Stance, CurrentAtomic];

/**
 * Whether combatant `e` might pass {@link mayEngage} wherever it stands: every `true` that function returns
 * without the index's presence test, read off `e`'s own {@link READY_MEMBERSHIP} stores alone. A superset -
 * a combatant for which this is false passes only when an owned one's presence test does.
 */
export function readyAnywhere(world: World, content: ContentSet, e: Entity): boolean {
  if (holdsLadderState(world, e)) return true;
  // A sleeper in the open, or one asleep on its tower.
  const garrisoned = world.has(e, Garrison);
  if (world.tryGet(e, CurrentAtomic)?.effect.kind === 'sleep' && (garrisoned || !world.has(e, Resting)))
    return true;
  const settler = world.get(e, Settler);
  if (isHunterJob(content, settler.jobType)) return true;
  const owner = world.tryGet(e, Owner);
  if (owner === undefined) {
    return garrisoned || !isAnimalTribe(content, settler.tribe) || isAggressiveAnimal(content, settler.tribe);
  }
  // Outside the player slots it holds no bit the presence test could find it by.
  if (!isValidPlayer(owner.player)) return true;
  const mode = stanceMode(world, content, e, settler.jobType);
  if (!guardsAnchor(content, mode, settler.jobType) || isTravelling(world, e)) return false;
  return (
    (world.tryGet(e, Stance)?.anchorCell ?? null) !== null ||
    world.has(e, PathRoute) ||
    world.has(e, Stranded)
  );
}

/** The radius (map points) {@link mayEngage}'s presence test asks for an owned unit that
 *  {@link searchesPastPresence} leaves out: the sight and defend radii. */
export const PRESENCE_RADIUS = Math.max(SIGHT_RADIUS_NODES, DEFEND_RADIUS_NODES);

/**
 * Whether owned unit `e` in a player slot may ask {@link mayEngage}'s presence test past
 * {@link PRESENCE_RADIUS}: a garrison, whose manned post searches its reach raised by the tower, or an IGNORE
 * guard, which searches its weapon's reach. Read off `e`'s own {@link READY_MEMBERSHIP} stores alone.
 */
export function searchesPastPresence(world: World, content: ContentSet, e: Entity): boolean {
  const owner = world.tryGet(e, Owner);
  if (owner === undefined || !isValidPlayer(owner.player)) return false;
  if (world.has(e, Garrison)) return true;
  const { jobType } = world.get(e, Settler);
  return isFighterJob(content, jobType) && stanceMode(world, content, e, jobType) === MILITARY_MODE.IGNORE;
}

/** Whether a unit under `mode` holds a guard's anchor: DEFEND, or IGNORE on a fighter. */
function guardsAnchor(content: ContentSet, mode: MilitaryMode, jobType: number | null): boolean {
  return mode === MILITARY_MODE.DEFEND || (mode === MILITARY_MODE.IGNORE && isFighterJob(content, jobType));
}

/** Whether guard `e` standing on `here` has a walk back to its post to make or route state to drop. */
function awayFromAnchor(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  here: NodeId,
): boolean {
  if (world.has(e, PathRoute) || world.has(e, Stranded)) return true;
  const anchor = world.tryGet(e, Stance)?.anchorCell ?? here;
  return anchor !== here && guardPost(world, ctx, terrain, anchor, here) !== here;
}

/** Whether `e` holds state the engage ladder resolves, re-checks or reaps whoever stands near it. */
function holdsLadderState(world: World, e: Entity): boolean {
  return (
    world.has(e, Engagement) ||
    world.has(e, AttackOrder) ||
    world.has(e, Anger) ||
    world.has(e, Fleeing) ||
    world.has(e, HuntFocus) ||
    world.has(e, UnreachableTargets)
  );
}

/** How far `e`'s weapon strikes in map points, 0 when it holds none. */
function reachOf(world: World, ctx: SystemContext, e: Entity): number {
  const { tribe, jobType, humanForm } = world.get(e, Settler);
  return attackerWeapon(ctx, tribe, jobType, world.tryGet(e, Weapon)?.weaponTypeId, humanForm)?.maxRange ?? 0;
}
