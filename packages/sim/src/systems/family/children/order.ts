import {
  Carrying,
  CHILD_FOOD_UNITS,
  ChildOrder,
  type ChildOrderBlocker,
  Engagement,
  FamilyDuty,
  Fleeing,
  isAboardVehicle,
  MakingLove,
  Marriage,
  ownerOf,
  PlayerOrder,
  Position,
  Residence,
  removeCurrentAtomic,
  Settler,
  Upgrading,
  Wedding,
} from '../../../components/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { interactionNodeId } from '../../footprint/interaction.js';
import { isTravelling } from '../../movement/nav-state.js';
import { isFood, jobIgnoresHomeHouse } from '../../readviews/index.js';
import { atomicHoldsSettler } from '../../settlers/atomics/busy.js';
import { startDrop } from '../../settlers/atomics/start.js';
import { isServedAtHome } from '../../settlers/drives/home-errands.js';
import { anyNeedPressing } from '../../settlers/drives/needs.js';
import { enterBuilding, isInside, stepIn, stepOut } from '../../settlers/indoors.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { unreachableGoalVeto } from '../../settlers/unreachable-goals.js';
import { landReachAt, navigationLimitFor } from '../../signposts/index.js';
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
 * Settlers a child-order pass is driving; their {@link FamilyDuty} fences them off the planner's economy
 * drives, while needs still fire. Whatever a pass does not re-claim, it strips at its end. Each claim is
 * stamped with its pass number, so the same couples claimed tick after tick rewrite entries in place.
 */
export class DutyClaims {
  private readonly stamps = new Map<Entity, number>();
  private pass = 0;
  private claimed = 0;

  /** Start a pass: every earlier claim lapses. */
  begin(): void {
    this.pass += 1;
    this.claimed = 0;
  }

  claim(e: Entity): void {
    if (this.stamps.get(e) === this.pass) return;
    this.stamps.set(e, this.pass);
    this.claimed += 1;
  }

  has(e: Entity): boolean {
    return this.stamps.get(e) === this.pass;
  }

  /** Forget `e`'s lapsed claim, keeping the stamps to the settlers still on duty. */
  forget(e: Entity): void {
    this.stamps.delete(e);
  }

  /** Drop the lapsed claims {@link forget} never saw, such as a claimed settler that died, once they
   *  outnumber this pass's own. */
  end(): void {
    if (this.stamps.size <= LAPSED_CLAIMS_SWEEP_RATIO * this.claimed + LAPSED_CLAIMS_SLACK) return;
    for (const [e, pass] of this.stamps) if (pass !== this.pass) this.stamps.delete(e);
  }
}

/** Lapsed claims are swept once the stamps hold this many times the live ones, plus the slack. */
const LAPSED_CLAIMS_SWEEP_RATIO = 2;
const LAPSED_CLAIMS_SLACK = 64;

/** The state one child-order pass shares across its orders. */
export type ChildOrderPass = {
  readonly dutyClaimed: DutyClaims;
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
  // The live record: a `mut` below edits this same object.
  const order = world.get(woman, ChildOrder);
  const blocked = home === undefined ? 'noHome' : blockerAt(world, ctx, woman, husband, home);
  if (order.blocked !== blocked) world.mut(woman, ChildOrder).blocked = blocked;
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
      birth(world, ctx, woman, husband, home, order.child);
    }
    return;
  }

  // Nothing is held back: residents eat the larder freely, so the cost is re-checked every tick and only
  // taken at the session start below.
  if (storedFoodUnits(world, ctx, home) < CHILD_FOOD_UNITS) {
    haulFood(world, ctx, terrain, woman, home, order.foodSearchMissed === true, pass);
    return;
  }
  // The larder holds the cost, whoever filled it, so a search that once found nothing is no longer news.
  if (order.foodSearchMissed === true) world.mut(woman, ChildOrder).foodSearchMissed = undefined;

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
  return home === undefined ? 'noHome' : blockerAt(world, ctx, woman, husband, home);
}

/** {@link childOrderBlocker} for the couple whose wife lives in `home`. */
function blockerAt(
  world: World,
  ctx: SystemContext,
  woman: Entity,
  husband: Entity,
  home: Entity,
): ChildOrderBlocker | undefined {
  // An upgrade must not interrupt the couple's already-paid hearts phase (owner ruling).
  if (builtHomeType(world, ctx, home) === undefined && !upgradeSparesSession(world, woman, home))
    return 'homeUnbuilt';
  if (jobIgnoresHomeHouse(ctx.content, world.get(husband, Settler).jobType)) return 'husbandAway';
  if (world.tryGet(husband, Residence)?.home !== home) return 'livesApart';
  if (standsOffHomeLand(world, ctx, woman, home) || standsOffHomeLand(world, ctx, husband, home))
    return 'homeAcrossWater';
  return undefined;
}

function upgradeSparesSession(world: World, woman: Entity, home: Entity): boolean {
  return world.has(home, Upgrading) && world.tryGet(home, MakingLove)?.wife === woman;
}

/**
 * Whether `e` stands ashore on other land than `home`'s door, where no walk home leads: our own rule, so a
 * household split by water, such as a husband ferried to another island, is never called home across it.
 * A rider aboard a vehicle is waited for instead, until it steps off.
 */
function standsOffHomeLand(world: World, ctx: SystemContext, e: Entity, home: Entity): boolean {
  const terrain = ctx.terrain;
  if (terrain === undefined || isAboardVehicle(world, e)) return false;
  const door = interactionNodeId(world, ctx, terrain, home);
  if (door === null) return false;
  const p = world.get(e, Position);
  const here = nodeOfPosition(p.x, p.y);
  return terrain.componentOf(terrain.nodeAtClamped(here.hx, here.hy)) !== terrain.componentOf(door);
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
  missed: boolean,
  pass: ChildOrderPass,
): void {
  claimDuty(world, woman, pass);
  leaveHome(world, woman, home);
  const load = world.tryGet(woman, Carrying);
  const loaded = load !== undefined && load.amount > 0;
  // Empty-handed between retries she has nothing to do, whether or not she is free.
  if (!loaded && missed && (ctx.tick + woman) % FOOD_SEARCH_RETRY_TICKS !== 0) return;
  if (!isDrivable(world, woman)) return;
  const womanView = world.get(woman, Settler);
  const p = world.get(woman, Position);
  const hereNode = nodeOfPosition(p.x, p.y);
  if (loaded) {
    if (!isFood(ctx, load.goodType)) {
      startDrop(world, ctx, woman); // free her hands of a non-food load first
      return;
    }
    removeCurrentAtomic(world, woman); // see enterHome
    deliverHome(world, ctx, terrain, woman, womanView, home, hereNode);
    return;
  }
  // This pass runs before the planner releases her last trip's claim, which must not hide its unit from her.
  pass.supply.releasePickupClaim(woman);
  // Her signpost area, else her own land: never a source across water.
  const limit =
    terrain !== undefined
      ? (navigationLimitFor(world, ctx.content, terrain, woman) ??
        landReachAt(terrain, terrain.nodeAtClamped(hereNode.hx, hereNode.hy)))
      : null;
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
  removeCurrentAtomic(world, woman); // see enterHome
  fetchFrom(world, ctx, terrain, woman, womanView, source, hereNode);
}

/** Release `e` from waiting inside `home`, but never mid-sleep, mid-prayer or mid-meal there: this system
 *  runs before the planner, so popping it out each tick would leave it finishing the errand at the door. */
function leaveHome(world: World, e: Entity, home: Entity): void {
  if (isInside(world, e, home) && !isServedAtHome(world, e)) stepOut(world, e);
}

/** Claim `e` for family duty this tick (idempotent). Taking a settler ends the economy errand it carried;
 *  the planner no longer releases a duty-bound settler's errands on the owner's account, only at its own
 *  re-plan, so the fetch this order stamps survives her walk. */
function claimDuty(world: World, e: Entity, pass: ChildOrderPass): void {
  if (!world.has(e, FamilyDuty)) {
    world.add(e, FamilyDuty, { duty: true });
    pass.supply.releaseErrands(e);
  }
  pass.dutyClaimed.claim(e);
}

/** Whether the pass may issue actions on `e` right now: the planner's idle test, plus the marks of the
 *  drives that outrank family duty. A rider seated aboard is off the map until its vehicle sets it down. */
function isDrivable(world: World, e: Entity): boolean {
  return (
    !isAboardVehicle(world, e) &&
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
  if (isInside(world, e, home)) return !anyNeedPressing(world, ctx, e);
  // A walk home is issued only to a drivable settler with no need pulling it away.
  if (!isDrivable(world, e) || anyNeedPressing(world, ctx, e)) return false;
  enterHome(world, ctx, terrain, e, home);
  return false;
}

/** Walk a drivable `e` to the home's door and step inside; mapless fixtures step in directly (no cells
 *  to walk). */
function enterHome(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph | undefined,
  e: Entity,
  home: Entity,
): void {
  // Shed a workplace rest marker so the walk home is visible; the arrival re-stamps it at the home.
  stepOut(world, e);
  // A clip left on a drivable settler holds nothing (a workshop's craft display), but plays on and
  // slides along the walk unless it is shed with the rest marker.
  removeCurrentAtomic(world, e);
  if (terrain === undefined) {
    stepIn(world, e, home);
    return;
  }
  const p = world.get(e, Position);
  const hereNode = nodeOfPosition(p.x, p.y);
  const here = terrain.nodeAtClamped(hereNode.hx, hereNode.hy);
  enterBuilding(world, e, home, here, interactionCell(world, ctx, terrain, home, here));
}
