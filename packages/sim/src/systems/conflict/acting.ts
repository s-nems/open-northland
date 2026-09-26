import {
  Anger,
  AttackOrder,
  Engagement,
  Fleeing,
  Garrison,
  HuntFocus,
  Owner,
  PathRoute,
  PlayerOrder,
  Settler,
  Stance,
  Stranded,
  UnreachableTargets,
  Weapon,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { isTravelling } from '../movement/nav-state.js';
import {
  isAggressiveAnimal,
  isAnimalTribe,
  isFighterJob,
  isHunterJob,
  MILITARY_MODE,
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
  if (mode === MILITARY_MODE.DEFEND || reachGuard) {
    // With nothing to fight, a guard walks back to its anchor and drops its route state.
    const anchor = world.tryGet(e, Stance)?.anchorCell ?? here;
    if (anchor !== here || world.has(e, PathRoute) || world.has(e, Stranded)) return true;
    if (reachGuard) radius = Math.max(radius, reachOf(world, ctx, e));
  }
  return index.othersWithin(owner.player, x, y, radius);
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
