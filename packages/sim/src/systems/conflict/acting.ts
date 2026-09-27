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
import type { TerrainGraph } from '../../nav/terrain/index.js';
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
import type { CombatIndex } from './combat-index.js';
import { asleepOnDuty } from './engage-combatant.js';
import { DEFEND_RADIUS_NODES } from './engagement.js';
import { ANIMAL_AGGRO_RADIUS_NODES, SIGHT_RADIUS_NODES } from './targeting.js';
import { attackerWeapon } from './weapons.js';

/**
 * Whether `e` may act in this combat pass. False proves `engageCombatant` would leave it with no write and
 * no draw: every rung it reaches either returns or drops state it does not hold, and the target search
 * finds nothing. Asked in the pass's own order, so it reads each unit as the ladder would.
 */
export function mayEngage(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  index: CombatIndex,
  e: Entity,
): boolean {
  if (holdsLadderState(world, e)) return true;
  // A sleeper in the open reads the battle front; any other clip holds its settler out of the pass.
  if (asleepOnDuty(world, e)) return true;
  if (atomicHoldsSettler(world, e)) return false;
  const order = world.tryGet(e, PlayerOrder);
  if (order !== undefined) return order.attackMove !== undefined; // a plain move order benches the unit
  const settler = world.get(e, Settler);
  // A hunter's prey search is never presence-gated, and it keeps its own rest and lock.
  if (isHunterJob(ctx.content, settler.jobType)) return true;
  if (world.has(e, Garrison)) return true; // a manned post searches at tower reach
  const owner = world.tryGet(e, Owner);
  const mode = owner === undefined ? null : stanceMode(world, ctx.content, e, settler.jobType);
  // Only the flee drive runs ahead of the rung that leaves a walker to the drive that sent it.
  if (mode !== MILITARY_MODE.FLEE && isTravelling(world, e)) return false;
  const here = entityNode(world, terrain, e);
  const x = terrain.xOf(here);
  const y = terrain.yOf(here);
  if (owner === undefined || mode === null) {
    if (!isAnimalTribe(ctx.content, settler.tribe)) return true; // a scenario civ's search is ungated
    // A passive animal stands down; a provoked one holds Anger.
    if (!isAggressiveAnimal(ctx.content, settler.tribe)) return false;
    return index.civsWithin(x, y, Math.max(ANIMAL_AGGRO_RADIUS_NODES, reachOf(world, ctx, e)));
  }
  // The flee drive and every owned search stay inside this, bar a guard's search further out.
  let radius = Math.max(SIGHT_RADIUS_NODES, DEFEND_RADIUS_NODES);
  const reachGuard = mode === MILITARY_MODE.IGNORE && isFighterJob(ctx.content, settler.jobType);
  if (guardsAnchor(ctx.content, mode, settler.jobType)) {
    // With nothing to fight, a guard walks back to its anchor and drops its route state.
    const anchor = world.tryGet(e, Stance)?.anchorCell ?? here;
    if (anchor !== here || world.has(e, PathRoute) || world.has(e, Stranded)) return true;
    if (reachGuard) radius = Math.max(radius, reachOf(world, ctx, e));
  }
  return index.othersWithin(owner.player, x, y, radius);
}

/** The stores whose membership, or whose values for {@link READY_VALUES}, can flip {@link readyAnywhere}.
 *  A job change arrives through the settler trade log instead: the needs write every Settler each tick. */
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
  PlayerOrder,
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
export const READY_VALUES: readonly Component<unknown>[] = [Owner, Stance, PlayerOrder, CurrentAtomic];

/**
 * Whether combatant `e` might pass {@link mayEngage} wherever it stands: every `true` that function returns
 * without the index's presence test, read off `e`'s own {@link READY_MEMBERSHIP} stores alone. A superset -
 * a combatant for which this is false passes only when an owned one's presence test does.
 */
export function readyAnywhere(world: World, content: ContentSet, e: Entity): boolean {
  if (holdsLadderState(world, e)) return true;
  // A sleeper in the open; one asleep on its tower holds a Garrison.
  if (world.tryGet(e, CurrentAtomic)?.effect.kind === 'sleep' && !world.has(e, Resting)) return true;
  if (world.tryGet(e, PlayerOrder)?.attackMove !== undefined) return true;
  const settler = world.get(e, Settler);
  if (isHunterJob(content, settler.jobType) || world.has(e, Garrison)) return true;
  const owner = world.tryGet(e, Owner);
  if (owner === undefined) {
    return !isAnimalTribe(content, settler.tribe) || isAggressiveAnimal(content, settler.tribe);
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

const presenceBounds = new WeakMap<ContentSet, number>();

/** The widest radius (map points) {@link mayEngage}'s presence test asks for an owned unit: the sight and
 *  defend radii, and the reach of any weapon a guard may hold. */
export function presenceBound(content: ContentSet): number {
  let bound = presenceBounds.get(content);
  if (bound === undefined) {
    bound = Math.max(SIGHT_RADIUS_NODES, DEFEND_RADIUS_NODES);
    for (const weapon of content.weapons) bound = Math.max(bound, weapon.maxRange);
    presenceBounds.set(content, bound);
  }
  return bound;
}

/** Whether a unit under `mode` holds a guard's anchor: DEFEND, or IGNORE on a fighter. */
function guardsAnchor(content: ContentSet, mode: MilitaryMode, jobType: number | null): boolean {
  return mode === MILITARY_MODE.DEFEND || (mode === MILITARY_MODE.IGNORE && isFighterJob(content, jobType));
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
  const { tribe, jobType } = world.get(e, Settler);
  return attackerWeapon(ctx, tribe, jobType, world.tryGet(e, Weapon)?.weaponTypeId)?.maxRange ?? 0;
}
