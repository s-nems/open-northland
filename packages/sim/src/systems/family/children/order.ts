import {
  Carrying,
  CHILD_FOOD_UNITS,
  ChildOrder,
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
import { isFood } from '../../readviews/index.js';
import { atomicHoldsSettler } from '../../settlers/atomics/busy.js';
import { startDrop } from '../../settlers/atomics/start.js';
import { anyNeedPressing } from '../../settlers/drives/needs.js';
import { enterBuilding, isInside, stepIn, stepOut } from '../../settlers/indoors.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { unreachableGoalVeto } from '../../settlers/unreachable-goals.js';
import { navigationLimitFor } from '../../signposts/index.js';
import { isOnMission } from '../eligibility.js';
import { deliverHome, fetchFrom } from '../food-haul.js';
import type { ExternalFoodIndex } from '../food-search.js';
import { builtHomeType, consumeFoodUnits, isMinor, setFoodReserve, storedFoodUnits } from '../households.js';
import { birth, makeLoveDuration } from './make-love.js';

/**
 * Ticks between the food searches of a wife whose last one found nothing, staggered by entity id. An
 * authored cost bound, not original behavior: her order resumes up to this long after food reaches a
 * store.
 */
export const FOOD_SEARCH_RETRY_TICKS = TICKS_PER_SECOND;

/**
 * The state one child-order pass shares across its orders. Both sets are claims re-made every tick:
 * whatever a tick does not re-claim, the pass strips at its end.
 */
export type ChildOrderPass = {
  /** Settlers this tick is driving; their {@link FamilyDuty} fences them off the planner's economy
   *  drives, while needs still fire. */
  readonly dutyClaimed: Set<Entity>;
  /** Homes whose {@link FoodReserve} this tick re-claimed, holding the child fund back from eaters. */
  readonly reservesReclaimed: Set<Entity>;
  readonly externalFood: ExternalFoodIndex;
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
  const homeType = home !== undefined ? builtHomeType(world, ctx, home) : undefined;
  const together = home !== undefined && world.tryGet(husband, Residence)?.home === home;
  const husbandAway = isOnMission(ctx.content, world.get(husband, Settler).jobType);
  // No capacity gate: `homeSize` caps families, and the newborn joins its parents' existing household.
  const active = home !== undefined && homeType !== undefined && together && !husbandAway;
  if (!active) {
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

  const food = storedFoodUnits(world, ctx, home);
  setFoodReserve(world, home, Math.min(CHILD_FOOD_UNITS, food));
  pass.reservesReclaimed.add(home);
  if (food < CHILD_FOOD_UNITS) {
    haulFood(world, ctx, terrain, woman, home, pass);
    return;
  }

  claimDuty(world, woman, pass);
  if (!ensureInside(world, ctx, terrain, woman, home)) return;
  claimDuty(world, husband, pass);
  if (!ensureInside(world, ctx, terrain, husband, home)) return;
  // Another couple's session holds the home: wait for our turn with the fund still reserved.
  if (love !== undefined) return;
  // The fund is spent and the hearts phase begins; the reserve is recomputed over what remains, so
  // another resident couple's fund in progress stays protected.
  consumeFoodUnits(world, ctx, home, CHILD_FOOD_UNITS);
  setFoodReserve(world, home, Math.min(CHILD_FOOD_UNITS, storedFoodUnits(world, ctx, home)));
  world.add(home, MakingLove, {
    wife: woman,
    elapsed: 0,
    duration: makeLoveDuration(ctx, world.get(woman, Settler).tribe),
  });
}

/** Drop an order that can never complete, and let its holder out of the house. */
function dropOrder(world: World, woman: Entity): void {
  world.remove(woman, ChildOrder);
  stepOut(world, woman);
}

/** A precondition failed: the order persists but nobody is driven. Only the couple's own session is
 *  touched, never another resident couple's or the home's centrally re-derived reserve. */
function standDown(world: World, woman: Entity, husband: Entity, home: Entity): void {
  if (isInside(world, woman, home)) stepOut(world, woman);
  if (isInside(world, husband, home)) stepOut(world, husband);
  if (world.tryGet(home, MakingLove)?.wife === woman) world.remove(home, MakingLove);
}

/** Larder short: the woman hauls food home; the husband keeps working until she waits inside. */
function haulFood(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph | undefined,
  woman: Entity,
  home: Entity,
  pass: ChildOrderPass,
): void {
  claimDuty(world, woman, pass);
  if (isInside(world, woman, home)) stepOut(world, woman);
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
    limit,
    unreachableGoalVeto(world, ctx, woman),
  );
  if (source === null) {
    // No reachable food outside homes, so she waits and the order stands.
    if (!missed) world.mut(woman, ChildOrder).foodSearchMissed = true;
    return;
  }
  if (missed) world.mut(woman, ChildOrder).foodSearchMissed = undefined;
  fetchFrom(world, ctx, terrain, woman, womanView, source, hereNode);
}

/** Claim `e` for family duty this tick (idempotent). */
function claimDuty(world: World, e: Entity, pass: ChildOrderPass): void {
  if (!world.has(e, FamilyDuty)) world.add(e, FamilyDuty, { duty: true });
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
 * need goes first: the needs drive runs after this system and outranks the {@link FamilyDuty} fence, and
 * the couple's own reserved child fund is inedible to them, so a re-driven spouse would starve mid-loop.
 */
function ensureInside(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph | undefined,
  e: Entity,
  home: Entity,
): boolean {
  if (anyNeedPressing(world, ctx.content, e)) return false;
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
