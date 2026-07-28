import {
  Carrying,
  CHILD_FOOD_UNITS,
  ChildOrder,
  CurrentAtomic,
  Engagement,
  FAMILY_DUTY,
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
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { isFood } from '../../readviews/index.js';
import { startDrop } from '../../settlers/atomics/start.js';
import { anyNeedPressing } from '../../settlers/drives/needs.js';
import { enterBuilding, isInside, stepIn, stepOut } from '../../settlers/indoors.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { unreachableGoalVeto } from '../../settlers/unreachable-goals.js';
import { navigationLimitFor } from '../../signposts/index.js';
import { isTravelling } from '../../spatial/nodes.js';
import { isOnMission } from '../eligibility.js';
import { deliverHome, fetchFrom } from '../food-haul.js';
import type { ExternalFoodIndex } from '../food-search.js';
import { builtHomeType, consumeFoodUnits, isMinor, setFoodReserve, storedFoodUnits } from '../households.js';
import { birth, makeLoveDuration } from './make-love.js';

/**
 * The state one child-order pass shares across its orders. Both sets are claims RE-MADE every tick:
 * whatever a tick does not re-claim, the pass strips at its end (`./system.ts`).
 */
export type ChildOrderPass = {
  /** Settlers this tick is driving. They carry {@link FamilyDuty}, which fences them off the AI planner's
   *  economy drives (needs still fire). */
  readonly dutyClaimed: Set<Entity>;
  /** Homes whose {@link FoodReserve} this tick re-claimed, holding the child fund back from eaters. */
  readonly reservesReclaimed: Set<Entity>;
  /** Shared by every order in the pass; self-builds on the first larder-short one. */
  readonly externalFood: ExternalFoodIndex;
};

/** Drive one standing {@link ChildOrder} a tick through its stages: stock the larder, wait inside, hearts,
 *  birth. Each stage returns, so at most one runs per tick. */
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
  // One child at a time: while the previous child grows up no new order stands. The `makeChild` command
  // guards this, and a child born by THIS order removes it at birth, so reaching here is a stale re-issue.
  if (marriage.child !== null && world.isAlive(marriage.child) && isMinor(world, marriage.child)) {
    dropOrder(world, woman);
    return;
  }

  const home = world.tryGet(woman, Residence)?.home;
  const homeType = home !== undefined ? builtHomeType(world, ctx, home) : undefined;
  const together = home !== undefined && world.tryGet(husband, Residence)?.home === home;
  const husbandAway = isOnMission(ctx.content, world.get(husband, Settler).jobType);
  // No capacity gate: `homeSize` caps FAMILIES (see familiesOf) and the newborn joins its parents'
  // existing household, so a couple with a home always has room for its child.
  const active = home !== undefined && homeType !== undefined && together && !husbandAway;
  if (!active) {
    if (home !== undefined) standDown(world, woman, husband, home);
    return;
  }

  const love = world.tryGet(home, MakingLove);
  if (love !== undefined && love.wife === woman) {
    claimDuty(world, woman, pass);
    claimDuty(world, husband, pass);
    world.write(home, MakingLove, (l) => {
      l.elapsed += 1;
    });
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
  // Both inside, but another couple's session holds the home: wait in for our turn (the fund stays
  // reserved, so nobody eats it while we queue).
  if (love !== undefined) return;
  // Both inside and the home is free: the fund is spent and the hearts phase begins. The reserve is
  // recomputed over what remains, so another resident couple's fund-in-progress stays protected.
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

/** A precondition failed: the order persists but nobody is driven. Only the couple's OWN session is touched;
 *  another resident couple's session, and the home's centrally re-derived reserve, are left alone. */
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
  if (isInside(world, woman, home)) stepOut(world, woman); // shouldn't happen (the reserve holds the fund)
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
  // Signpost confinement: she only sees sources inside her local circle + reachable guidepost network
  // (null when navigation is off/unlimited, the pre-signpost behaviour, byte-identical).
  const limit = terrain !== undefined ? navigationLimitFor(world, ctx.content, terrain, woman) : null;
  const source = pass.externalFood.nearest(
    hereNode,
    ownerOf(world, woman),
    limit,
    unreachableGoalVeto(world, ctx, woman),
  );
  if (source === null) return; // no reachable food outside homes: she waits (the order stands)
  fetchFrom(world, ctx, terrain, woman, womanView, source, hereNode);
}

/** Claim `e` for family duty this tick (idempotent). */
function claimDuty(world: World, e: Entity, pass: ChildOrderPass): void {
  if (!world.has(e, FamilyDuty)) world.add(e, FamilyDuty, FAMILY_DUTY);
  pass.dutyClaimed.add(e);
}

/** Whether the pass may issue actions on `e` right now: the planner's own idle test plus the marks of the
 *  drives that outrank family duty (a player order in flight, combat, a wedding). */
function isDrivable(world: World, e: Entity): boolean {
  return (
    !world.has(e, CurrentAtomic) &&
    !isTravelling(world, e) &&
    !world.has(e, PlayerOrder) &&
    !world.has(e, Engagement) &&
    !world.has(e, Fleeing) &&
    !world.has(e, Wedding)
  );
}

/**
 * Bring `e` to rest inside `home`, or let a pressing need take it first: true only once it is inside with
 * no need pulling it away (ready to make love). A hungry/tired/devout spouse feeds, sleeps, or prays first,
 * because the needs drive runs after this system and outranks the {@link FamilyDuty} fence: re-driving `e`
 * home each tick would fight that walk and it would never reach food, and its own reserved child fund is
 * inedible to it, so it would starve mid-loop. `e` stays claimed; the needs drive steps it back out, and
 * this walk resumes once the need clears.
 */
function ensureInside(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph | undefined,
  e: Entity,
  home: Entity,
): boolean {
  if (anyNeedPressing(world.get(e, Settler))) return false;
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
  // A husband claimed straight out of a workshop/farm rest still carries that marker: shed it so the walk
  // home is visible; the arrival re-stamps it at the home.
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
