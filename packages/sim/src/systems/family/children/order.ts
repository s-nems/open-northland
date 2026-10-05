import {
  Carrying,
  CHILD_FOOD_UNITS,
  ChildOrder,
  type ChildOrderBlocker,
  Engagement,
  FamilyDuty,
  Fleeing,
  MakingLove,
  Marriage,
  ownerOf,
  PlayerOrder,
  Position,
  Residence,
  Settler,
  Wedding,
} from '../../../components/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { isTravelling } from '../../movement/nav-state.js';
import { isFood, jobIgnoresHomeHouse } from '../../readviews/index.js';
import { atomicHoldsSettler } from '../../settlers/atomics/busy.js';
import { startDrop } from '../../settlers/atomics/start.js';
import { isServedAtHome } from '../../settlers/drives/home-errands.js';
import { anyNeedPressing } from '../../settlers/drives/needs.js';
import { enterBuilding, isInside, stepIn, stepOut } from '../../settlers/indoors.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { unreachableGoalVeto } from '../../settlers/unreachable-goals.js';
import { navigationLimitFor } from '../../signposts/index.js';
import type { SupplyTally } from '../../stores/index.js';
import { deliverHome, fetchFrom, HAUL_LIFT_UNITS } from '../food-haul.js';
import type { ExternalFoodIndex } from '../food-search.js';
import { builtHomeType, consumeFoodUnits, isMinor, storedFoodUnits } from '../households.js';
import { birth, makeLoveDuration } from './make-love.js';

/**
 * Ticks between the food searches of a wife whose last one found nothing, staggered by entity id. An
 * authored cost bound, not original behavior: her order resumes up to this long after food reaches a
 * store.
 */
export const FOOD_SEARCH_RETRY_TICKS = TICKS_PER_SECOND;

/**
 * The state one child-order pass shares across its orders. `dutyClaimed` is re-made every tick: whatever
 * a tick does not re-claim, the pass strips at its end.
 */
export type ChildOrderPass = {
  /** Settlers this tick is driving; their {@link FamilyDuty} fences them off the planner's economy
   *  drives, while needs still fire. */
  readonly dutyClaimed: Set<Entity>;
  readonly externalFood: ExternalFoodIndex;
  readonly supply: SupplyTally;
};

/** Drive one standing {@link ChildOrder} a tick through its stages: stock the larder, wait inside, hearts,
 *  birth. At most one stage runs per tick. */
export function driveOrder(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph | undefined,
  woman: Entity,
  pass: ChildOrderPass,
): void {
  const marriage = world.tryGet(woman, Marriage);
  // A widow's (or somehow-unmarried) order can never complete.
  if (marriage === undefined || !world.isAlive(marriage.spouse)) {
    dropOrder(world, woman);
    return;
  }
  const husband = marriage.spouse;
  // One child at a time: the `makeChild` command guards it, so reaching here is a stale re-issue.
  if (marriage.child !== null && world.isAlive(marriage.child) && isMinor(world, marriage.child)) {
    dropOrder(world, woman);
    return;
  }

  const home = world.tryGet(woman, Residence)?.home;
  const blocked = childOrderBlocker(world, ctx, woman, husband);
  if (world.get(woman, ChildOrder).blocked !== blocked) world.mut(woman, ChildOrder).blocked = blocked;
  if (home === undefined || blocked !== undefined) {
    if (home !== undefined) standDown(world, woman, husband, home);
    return;
  }

  const love = world.tryGet(home, MakingLove);
  if (love !== undefined && love.wife === woman) {
    claimDuty(world, woman, pass);
    claimDuty(world, husband, pass);
    world.mut(home, MakingLove).elapsed += 1;
    if (love.elapsed >= love.duration) {
      birth(world, ctx, woman, husband, home, world.get(woman, ChildOrder).child);
    }
    return;
  }

  // Nothing is held back: residents eat the larder freely, so the cost is re-checked every tick and only
  // taken at the session start below.
  if (storedFoodUnits(world, ctx, home) < CHILD_FOOD_UNITS) {
    haulFood(world, ctx, terrain, woman, home, pass);
    return;
  }
  // The larder holds the cost, whoever filled it, so a search that once found nothing is no longer news.
  if (world.get(woman, ChildOrder).foodSearchMissed === true)
    world.mut(woman, ChildOrder).foodSearchMissed = undefined;

  claimDuty(world, woman, pass);
  if (!ensureInside(world, ctx, terrain, woman, home)) return;
  claimDuty(world, husband, pass);
  if (!ensureInside(world, ctx, terrain, husband, home)) return;
  // Another couple's session holds the home: wait for our turn.
  if (love !== undefined) return;
  // Original behavior: the cost is taken once both spouses are home, as the hearts phase begins.
  consumeFoodUnits(world, ctx, home, CHILD_FOOD_UNITS);
  world.add(home, MakingLove, {
    wife: woman,
    elapsed: 0,
    duration: makeLoveDuration(ctx, world.get(woman, Settler).tribe),
  });
}

/**
 * What keeps a married couple from starting a child, or undefined when nothing does. No capacity gate:
 * `homeSize` caps families, and the newborn joins its parents' existing household. Original behavior:
 * the child task fails while the husband's trade is one `jobtypes.ini` marks `ignoresHomeHouseFlag`.
 */
export function childOrderBlocker(
  world: World,
  ctx: SystemContext,
  woman: Entity,
  husband: Entity,
): ChildOrderBlocker | undefined {
  const home = world.tryGet(woman, Residence)?.home;
  if (home === undefined) return 'noHome';
  if (builtHomeType(world, ctx, home) === undefined) return 'homeUnbuilt';
  if (jobIgnoresHomeHouse(ctx.content, world.get(husband, Settler).jobType)) return 'husbandAway';
  if (world.tryGet(husband, Residence)?.home !== home) return 'livesApart';
  return undefined;
}

/** Drop an order that can never complete, and let its holder out of the house. */
function dropOrder(world: World, woman: Entity): void {
  world.remove(woman, ChildOrder);
  if (!isServedAtHome(world, woman)) stepOut(world, woman);
}

/** A precondition failed: the order persists but nobody is driven. Only the couple's own session is
 *  touched, never another resident couple's. */
function standDown(world: World, woman: Entity, husband: Entity, home: Entity): void {
  leaveHome(world, woman, home);
  leaveHome(world, husband, home);
  if (world.tryGet(home, MakingLove)?.wife === woman) world.remove(home, MakingLove);
}

/** Larder short of the child cost: the woman hauls food home; the husband keeps working until she waits
 *  inside. */
function haulFood(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph | undefined,
  woman: Entity,
  home: Entity,
  pass: ChildOrderPass,
): void {
  claimDuty(world, woman, pass);
  leaveHome(world, woman, home);
  if (!isDrivable(world, woman)) return;
  const load = world.tryGet(woman, Carrying);
  const womanView = world.get(woman, Settler);
  const p = world.get(woman, Position);
  const hereNode = nodeOfPosition(p.x, p.y);
  if (load !== undefined && load.amount > 0) {
    if (!isFood(ctx, load.goodType)) {
      startDrop(world, ctx, woman); // free her hands of a non-food load first
      return;
    }
    deliverHome(world, ctx, terrain, woman, womanView, home, hereNode);
    return;
  }
  const missed = world.get(woman, ChildOrder).foodSearchMissed === true;
  if (missed && (ctx.tick + woman) % FOOD_SEARCH_RETRY_TICKS !== 0) return;
  // Null when navigation is unlimited; otherwise she sees only sources inside her allowed area.
  const limit = terrain !== undefined ? navigationLimitFor(world, ctx.content, terrain, woman) : null;
  const source = pass.externalFood.nearest(
    hereNode,
    ownerOf(world, woman),
    home,
    limit,
    unreachableGoalVeto(world, ctx, woman),
  );
  if (source === null) {
    // No reachable food outside homes, so she waits and the order stands.
    if (!missed) world.mut(woman, ChildOrder).foodSearchMissed = true;
    return;
  }
  if (missed) world.mut(woman, ChildOrder).foodSearchMissed = undefined;
  pass.supply.stampPickupClaim(woman, {
    source: source.store,
    goodType: source.goodType,
    amount: HAUL_LIFT_UNITS,
  });
  fetchFrom(world, ctx, terrain, woman, womanView, source, hereNode);
}

/** Release `e` from waiting inside `home`, but never mid-sleep, mid-prayer or mid-meal there: this system
 *  runs before the planner, so popping it out each tick would leave it finishing the errand at the door. */
function leaveHome(world: World, e: Entity, home: Entity): void {
  if (isInside(world, e, home) && !isServedAtHome(world, e)) stepOut(world, e);
}

/** Claim `e` for family duty this tick (idempotent). Taking a settler ends the economy errand it carried;
 *  the planner leaves a duty-bound settler's errands alone, since this order stamps its own. */
function claimDuty(world: World, e: Entity, pass: ChildOrderPass): void {
  if (!world.has(e, FamilyDuty)) {
    world.add(e, FamilyDuty, { duty: true });
    pass.supply.releaseErrands(e);
  }
  pass.dutyClaimed.add(e);
}

/** Whether the pass may issue actions on `e` right now: the planner's idle test, plus the marks of the
 *  drives that outrank family duty. */
function isDrivable(world: World, e: Entity): boolean {
  return (
    !atomicHoldsSettler(world, e) &&
    !isTravelling(world, e) &&
    !world.has(e, PlayerOrder) &&
    !world.has(e, Engagement) &&
    !world.has(e, Fleeing) &&
    !world.has(e, Wedding)
  );
}

/**
 * Bring `e` to rest inside `home`, true only once it is inside with no need pulling it away. A pressing
 * need goes first: the needs drive runs after this system and outranks the {@link FamilyDuty} fence, so
 * a spouse re-driven home every tick would never reach what it needs.
 */
function ensureInside(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph | undefined,
  e: Entity,
  home: Entity,
): boolean {
  if (anyNeedPressing(world, ctx, e)) return false;
  if (isInside(world, e, home)) return true;
  enterHome(world, ctx, terrain, e, home);
  return false;
}

/** Walk to the home's door and step inside; mapless fixtures step in directly (no cells to walk). */
function enterHome(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph | undefined,
  e: Entity,
  home: Entity,
): void {
  if (!isDrivable(world, e)) return;
  // Shed a workplace rest marker so the walk home is visible; the arrival re-stamps it at the home.
  stepOut(world, e);
  if (terrain === undefined) {
    stepIn(world, e, home);
    return;
  }
  const p = world.get(e, Position);
  const hereNode = nodeOfPosition(p.x, p.y);
  const here = terrain.nodeAtClamped(hereNode.hx, hereNode.hy);
  enterBuilding(world, e, home, here, interactionCell(world, ctx, terrain, home, here));
}
