import {
  CoinDrillOrder,
  hasMissionBehaviour,
  MISSION_BEHAVIOUR,
  type SettlerIdentity,
  SettlerProgress,
  sameSide,
  Weapon,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId } from '../../../nav/terrain/index.js';
import { guardPost } from '../../conflict/chase.js';
import type { SystemContext } from '../../context.js';
import { walkBlockMask } from '../../footprint/walk-block-mask.js';
import { COIN_DRILL_ATOMIC_ID, coinDrillClip, mayCoinDrill } from '../../progression/coin-drill.js';
import { isBarracks } from '../../readviews/index.js';
import { atOrWalk, startAtomic } from '../atomics/start.js';
import { enterBuilding } from '../indoors.js';
import type { PlannerContext } from '../planner/context.js';
import { interactionCell } from '../targets/index.js';
import { isUnreachableGoal, unreachableGoals } from '../unreachable-goals.js';
import {
  coinDrillTermRuns,
  freeDrillCoins,
  startCoinDrillTerm,
  turnBackFromCoinDrill,
} from './coin-drill-coins.js';
import { drillDoorOpen } from './training.js';

const NO_EXPERIENCE: ReadonlyMap<number, number> = new Map();

/**
 * The coin-drill rung: walk a soldier's `CoinDrillOrder` to the barracks door and drill inside one term
 * after another while he may drill: a term starts on a coin no other man speaks for ({@link freeDrillCoins})
 * and repeats the drill clip until it is served; a needs detour leaves it running. Otherwise he steps out and
 * walks back to the node he left from, where the order ends. A soldier whose coin was taken out of the stock
 * on his way so walks there and straight back. Our rule.
 */
export function planCoinDrill(plan: PlannerContext, settler: SettlerIdentity): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  const order = world.tryGet(e, CoinDrillOrder);
  if (order === undefined) return false;
  if (order.stage === 'drill') {
    const house = order.house;
    // The house first: a razed barracks has no door to resolve.
    const standing = isBarracks(world, ctx, house) && sameSide(world, e, house);
    const door = standing ? interactionCell(world, ctx, terrain, house, here) : undefined;
    const clip = coinDrillClip(ctx.content, settler);
    if (clip !== undefined && door !== undefined && drillGoesOn(plan, settler, door)) {
      enterBuilding(world, e, house, here, door, () => {
        const paid =
          coinDrillTermRuns(world, e) ||
          (freeDrillCoins(world, ctx, house, e) > 0 && startCoinDrillTerm(world, ctx, e, house, clip));
        if (!paid) {
          turnBackFromCoinDrill(world, ctx, e);
          return;
        }
        startAtomic(world, e, COIN_DRILL_ATOMIC_ID, { kind: 'coinDrill', house }, clip.length, house);
      });
      return true;
    }
    turnBackFromCoinDrill(world, ctx, e);
  }
  const back = wayBack(plan, world.get(e, CoinDrillOrder).returnTo);
  if (back === undefined) {
    world.remove(e, CoinDrillOrder);
    return false;
  }
  atOrWalk(world, e, here, back, () => world.remove(e, CoinDrillOrder));
  return true;
}

/**
 * The node he walks back to: the one he left from, or, as a fresh recruit's rally post, the open node
 * nearest it when a building now stands there. Undefined when no way leads back, so the order ends where
 * he stands rather than in a refused route.
 */
function wayBack(plan: PlannerContext, returnTo: NodeId): NodeId | undefined {
  const { world, ctx, terrain, entity: e, here, limit } = plan;
  const back = guardPost(world, ctx, terrain, returnTo, here);
  if (walkBlockMask(world, ctx, terrain).has(back)) return undefined;
  if (limit !== null && !limit.allowsNode(back)) return undefined;
  if (isUnreachableGoal(unreachableGoals(world, ctx, e), back)) return undefined;
  return back;
}

/** Whether he keeps on at his side's standing barracks: its door is open to him and he may still drill. */
function drillGoesOn(plan: PlannerContext, settler: SettlerIdentity, door: NodeId): boolean {
  const { world, ctx, entity: e } = plan;
  if (!drillDoorOpen(world, ctx, e, door, plan.limit)) return false;
  return soldierMayCoinDrill(world, ctx, e, settler);
}

/** {@link mayCoinDrill} on `e`'s own state, refused too for a man a mission bars from experience: he would
 *  pay and gain nothing. */
export function soldierMayCoinDrill(
  world: World,
  ctx: SystemContext,
  e: Entity,
  settler: SettlerIdentity,
): boolean {
  if (hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.NO_JOB_EXPERIENCE)) return false;
  const experience = world.tryGet(e, SettlerProgress)?.experience ?? NO_EXPERIENCE;
  return mayCoinDrill(ctx.content, settler, world.tryGet(e, Weapon)?.weaponTypeId, experience);
}
