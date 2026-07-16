import {
  Age,
  Carrying,
  CHILD_FOOD_UNITS,
  ChildOrder,
  CurrentAtomic,
  Engagement,
  FAMILY_DUTY,
  FamilyDuty,
  FEMALE,
  Female,
  Fleeing,
  FoodReserve,
  Health,
  MakingLove,
  Marriage,
  Owner,
  PlayerOrder,
  Position,
  Residence,
  Resting,
  Settler,
  Wedding,
} from '../../components/index.js';
import { fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { atOrWalk, PILEUP_ATOMIC_ID, startAtomic, startDrop, startPickup } from '../agents/actions.js';
import { interactionCell } from '../agents/targets/index.js';
import { DEFAULT_SETTLER_HITPOINTS } from '../conflict/spawn/index.js';
import type { SystemContext } from '../context.js';
import { BABY_FEMALE, BABY_MALE, CIVILIST_JOB, WOMAN_JOB } from '../lifecycle/ageclass.js';
import { stampDefaultStance } from '../orders/index.js';
import { atomicAnimationName, atomicDuration, atomicDurationForName } from '../readviews/animations.js';
import { navigationLimitFor } from '../signposts/index.js';
import { canonicalById, isTravelling } from '../spatial.js';
import { isFood } from '../stores/index.js';
import { isOnMission } from './eligibility.js';
import { ExternalFoodIndex } from './food-search.js';
import { builtHomeType, consumeFoodUnits, isMinor, setFoodReserve, storedFoodUnits } from './households.js';

/**
 * The child-making half of the FamilySystem — drive each married woman's standing {@link ChildOrder}
 * through its stages:
 *
 *  1. **Stock the larder** — she hauls food into the couple's home until it holds
 *     {@link CHILD_FOOD_UNITS}; the stocked units are reserved (the home's {@link FoodReserve}) so no
 *     resident eats the child fund.
 *  2. **Wait inside** — she enters the home ({@link Resting} at it — render hides her) and waits for her
 *     husband, who then comes home and enters too.
 *  3. **Make love** — hearts show over the home ({@link MakingLove}, the original's MAKE_LOVE house
 *     overlay); the food is consumed at its start.
 *  4. **Birth** — the whole family steps out with the newborn of the ordered sex, which joins the
 *     household; the order is done. The couple may order again once this child grows up.
 *
 * The order deactivates (but persists) while its preconditions fail — no shared built home, the husband
 * away on a mission (soldier/scout — the wife does not wait for him).
 * Every settler the pass is actively driving carries {@link FamilyDuty}, which fences it off from the AI
 * planner's economy drives (needs still fire); duty is re-derived each tick, so a deactivated order frees
 * its settlers the same tick.
 *
 * Source basis: the stage vocabulary (kiss → make_love at the home → give_birth; hearts anchored to the
 * house) is pinned to `logicdefines.inc` atomics 78–80 + the MAKE_LOVE house overlay; the food threshold,
 * the ordered sex, and the one-child limit are user-specified design (the original gates conception
 * engine-internally — homes are its only food-stocking residences). Named approximation: the give_birth
 * atomic (80) is never played — the family simply steps out with the newborn (no birth animation is
 * bound in the sandbox catalog).
 */

/** The make-love atomic id (`logicdefines.inc` `MAKE_LOVE = 78`) — used only to resolve the hearts
 *  phase's duration from the tribe's bound animation. The sandbox catalog transcribes the same id
 *  (`app/game/sandbox/content/catalog/tribes.ts`); both pin to the decoded define. */
const MAKE_LOVE_ATOMIC_ID = 78;

/** Hearts-phase length (ticks) when no make_love animation resolves from content — the viking
 *  `viking_civilist_make_love` `length 200` (`atomicanimations.ini`), pinned as the fallback. */
const MAKE_LOVE_DURATION_FALLBACK = 200;

/** How long the couple makes love: the longer of the tribe's two bound make_love clips (the man's drives
 *  at 200 ticks, the woman's at 50), or the pinned fallback when neither resolves. */
function makeLoveDuration(ctx: SystemContext, tribe: number): number {
  const durations = [WOMAN_JOB, CIVILIST_JOB]
    .map((jobType) => atomicAnimationName(ctx.content, { tribe, jobType }, MAKE_LOVE_ATOMIC_ID))
    .filter((name): name is string => name !== undefined)
    .map((name) => atomicDurationForName(ctx.content, name));
  return durations.length > 0 ? Math.max(...durations) : MAKE_LOVE_DURATION_FALLBACK;
}

/** Drive every standing child order one tick, re-deriving the {@link FamilyDuty} fence: a settler the
 *  pass didn't claim this tick loses the marker (and with it the planner exemption). The pass also
 *  re-derives each home's {@link FoodReserve} (an order that held it must re-claim it every tick) and
 *  validates the {@link MakingLove} sessions centrally — several order-holding couples may share one
 *  home, and only a session's OWNING couple may advance or cancel it. */
export function driveChildOrders(world: World, ctx: SystemContext, terrain: TerrainGraph | undefined): void {
  cancelAbandonedSessions(world);
  const dutyBefore = canonicalById(world.query(FamilyDuty));
  const dutyNow = new Set<Entity>();
  const reservedHomes = new Set<Entity>();
  // One shared food index for every order this tick (it self-builds on the first larder-short order).
  const externalFood = new ExternalFoodIndex(world, ctx, terrain);
  for (const e of canonicalById(world.query(ChildOrder, Settler, Position))) {
    driveOrder(world, ctx, terrain, e, dutyNow, reservedHomes, externalFood);
  }
  for (const home of canonicalById(world.query(FoodReserve))) {
    if (!reservedHomes.has(home)) world.remove(home, FoodReserve);
  }
  for (const e of dutyBefore) {
    if (!dutyNow.has(e)) world.remove(e, FamilyDuty);
  }
}

/**
 * Cancel every {@link MakingLove} session whose owning couple no longer carries it out — the wife died,
 * dropped her order, moved home, or either parent stepped (or was pulled) outside. Centralised so an
 * abandoned session can never linger and block the home for its other resident couples; the consumed
 * food stays spent.
 */
function cancelAbandonedSessions(world: World): void {
  for (const home of canonicalById(world.query(MakingLove))) {
    const wife = world.get(home, MakingLove).wife;
    const marriage = world.isAlive(wife) ? world.tryGet(wife, Marriage) : undefined;
    const husband = marriage !== undefined && world.isAlive(marriage.spouse) ? marriage.spouse : undefined;
    const valid =
      husband !== undefined &&
      world.has(wife, ChildOrder) &&
      world.tryGet(wife, Residence)?.home === home &&
      isInside(world, wife, home) &&
      isInside(world, husband, home);
    if (!valid) world.remove(home, MakingLove);
  }
}

/** Claim `e` for family duty this tick (idempotent). */
function claim(world: World, e: Entity, dutyNow: Set<Entity>): void {
  if (!world.has(e, FamilyDuty)) world.add(e, FamilyDuty, FAMILY_DUTY);
  dutyNow.add(e);
}

/** Whether the pass may issue actions on `e` right now — the planner's own idle test plus the marks of
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

/** Whether `e` is currently waiting inside `home` (its {@link Resting} marker points there). */
function isInside(world: World, e: Entity, home: Entity): boolean {
  return world.tryGet(e, Resting)?.at === home;
}

/** Step `e` out of the house it waits in (deactivation, birth). */
function stepOut(world: World, e: Entity): void {
  world.remove(e, Resting);
}

function driveOrder(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph | undefined,
  woman: Entity,
  dutyNow: Set<Entity>,
  reservedHomes: Set<Entity>,
  externalFood: ExternalFoodIndex,
): void {
  const marriage = world.tryGet(woman, Marriage);
  // A widow's (or somehow-unmarried) order cannot ever complete — drop it.
  if (marriage === undefined || !world.isAlive(marriage.spouse)) {
    world.remove(woman, ChildOrder);
    stepOut(world, woman);
    return;
  }
  const husband = marriage.spouse;
  // One child at a time: while the previous child grows up no new order stands (the command guards
  // this; a child born by THIS order removes it at birth, so reaching here means a stale re-issue).
  if (marriage.child !== null && world.isAlive(marriage.child) && isMinor(world, marriage.child)) {
    world.remove(woman, ChildOrder);
    stepOut(world, woman);
    return;
  }

  const home = world.tryGet(woman, Residence)?.home;
  const homeType = home !== undefined ? builtHomeType(world, ctx, home) : undefined;
  const together = home !== undefined && world.tryGet(husband, Residence)?.home === home;
  const husbandAway = isOnMission(world.get(husband, Settler).jobType);
  // No capacity gate: `homeSize` caps FAMILIES (see familiesOf) and the newborn joins its parents'
  // existing household, so a couple with a home always has room for its child.
  const active = home !== undefined && homeType !== undefined && together && !husbandAway;
  if (!active) {
    // The order persists but nobody is driven: the couple lives normally (and steps back outside).
    // Only the couple's OWN session/state is touched — another resident couple's session and the home's
    // reserve (re-derived centrally each tick) are left alone.
    if (home !== undefined) {
      if (isInside(world, woman, home)) stepOut(world, woman);
      if (isInside(world, husband, home)) stepOut(world, husband);
      // Stepping the owner out abandons its session; the central sweep removes it next tick, but doing
      // it here keeps the hearts honest within this tick too.
      if (world.tryGet(home, MakingLove)?.wife === woman) world.remove(home, MakingLove);
    }
    return;
  }

  const love = world.tryGet(home, MakingLove);
  if (love !== undefined && love.wife === woman) {
    // Hearts over the house — this couple's session (the central sweep already validated both parents
    // are still inside; a cancelled session's consumed food stays spent).
    claim(world, woman, dutyNow);
    claim(world, husband, dutyNow);
    love.elapsed += 1;
    world.touch(home);
    if (love.elapsed >= love.duration) {
      birth(world, ctx, woman, husband, home, world.get(woman, ChildOrder).child);
    }
    return;
  }

  const food = storedFoodUnits(world, ctx, home);
  // Reserve what is already stocked (up to the child fund) so residents don't eat it back down.
  setFoodReserve(world, home, Math.min(CHILD_FOOD_UNITS, food));
  reservedHomes.add(home);

  if (food >= CHILD_FOOD_UNITS) {
    claim(world, woman, dutyNow);
    if (!isInside(world, woman, home)) {
      enterHome(world, ctx, terrain, woman, home);
      return;
    }
    claim(world, husband, dutyNow);
    if (!isInside(world, husband, home)) {
      enterHome(world, ctx, terrain, husband, home);
      return;
    }
    // Both inside — but another couple's session holds the home: wait in for our turn (the fund stays
    // reserved, so nobody eats it while we queue).
    if (love !== undefined) return;
    // Both inside and the home is free: the fund is spent and the hearts phase begins. The reserve is
    // recomputed over what remains (another resident couple's fund-in-progress stays protected; with
    // nothing left it clears on the next tick's central re-derive).
    consumeFoodUnits(world, ctx, home, CHILD_FOOD_UNITS);
    setFoodReserve(world, home, Math.min(CHILD_FOOD_UNITS, storedFoodUnits(world, ctx, home)));
    const tribe = world.get(woman, Settler).tribe;
    world.add(home, MakingLove, { wife: woman, elapsed: 0, duration: makeLoveDuration(ctx, tribe) });
    return;
  }

  // Larder short: the woman hauls food home; the husband keeps working until she waits inside.
  claim(world, woman, dutyNow);
  if (isInside(world, woman, home)) stepOut(world, woman); // shouldn't happen (reserve holds the fund)
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
  // (null when navigation is off/unlimited — the pre-signpost behaviour, byte-identical).
  const limit = terrain !== undefined ? navigationLimitFor(world, terrain, woman) : null;
  const source = externalFood.nearest(hereNode, limit);
  if (source === null) return; // no reachable food outside homes — she waits (the order stands)
  fetchFrom(world, ctx, terrain, woman, womanView, source, hereNode);
}

/** Walk to the home's door and step inside ({@link Resting} — the render hides her, like a workshop
 *  operator resting in). Mapless fixtures step in directly (no cells to walk). */
function enterHome(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph | undefined,
  e: Entity,
  home: Entity,
): void {
  if (!isDrivable(world, e)) return;
  // A husband claimed straight out of a workshop/farm rest still carries that marker — shed it so
  // the walk home is visible (the render hides any Resting settler); `enter` re-stamps it at the home.
  if (world.tryGet(e, Resting)?.at !== home) world.remove(e, Resting);
  const enter = (): void => {
    world.add(e, Resting, { at: home });
  };
  if (terrain === undefined) {
    enter();
    return;
  }
  const p = world.get(e, Position);
  const hereNode = nodeOfPosition(p.x, p.y);
  const here = terrain.nodeAtClamped(hereNode.hx, hereNode.hy);
  atOrWalk(world, e, here, interactionCell(world, ctx, terrain, home, here), enter);
}

/** Carry the held food unit home and pile it into the larder. */
export function deliverHome(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph | undefined,
  e: Entity,
  settler: { tribe: number; jobType: number | null },
  home: Entity,
  hereNode: { hx: number; hy: number },
): void {
  const pileUp = (): void => {
    startAtomic(
      world,
      e,
      PILEUP_ATOMIC_ID,
      { kind: 'pileup', store: home },
      atomicDuration(ctx.content, settler, PILEUP_ATOMIC_ID),
      home,
    );
  };
  if (terrain === undefined) {
    pileUp();
    return;
  }
  const here = terrain.nodeAtClamped(hereNode.hx, hereNode.hy);
  atOrWalk(world, e, here, interactionCell(world, ctx, terrain, home, here), pileUp);
}

/** Walk to the found food store and lift one unit. */
export function fetchFrom(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph | undefined,
  e: Entity,
  settler: { tribe: number; jobType: number | null },
  source: { store: Entity; goodType: number },
  hereNode: { hx: number; hy: number },
): void {
  const lift = (): void => startPickup(world, ctx, e, settler, source.store, source.goodType, 1);
  if (terrain === undefined) {
    lift();
    return;
  }
  const here = terrain.nodeAtClamped(hereNode.hx, hereNode.hy);
  atOrWalk(world, e, here, interactionCell(world, ctx, terrain, source.store, here), lift);
}

/**
 * The birth: the newborn of the ordered sex joins the family (a baby with an {@link Age}, the parents'
 * {@link Owner}, and a {@link Residence} in the home), everybody steps back outside, and the order is
 * done. Emits `settlerBorn` (the original's birth jingle, `DM_MUSIC_TYPE_JINGLE_BIRTH`).
 */
function birth(
  world: World,
  ctx: SystemContext,
  mother: Entity,
  father: Entity,
  home: Entity,
  sex: 'female' | 'male',
): void {
  const p = world.get(mother, Position); // she stands at the door she entered by — the baby appears there
  const baby = world.create();
  world.add(baby, Position, { x: p.x, y: p.y });
  world.add(baby, Settler, {
    tribe: world.get(mother, Settler).tribe,
    jobType: sex === 'male' ? BABY_MALE : BABY_FEMALE,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  if (sex === 'female') world.add(baby, Female, FEMALE);
  world.add(baby, Age, { ticks: 0 });
  // A newborn gets the default human pool (no per-age hitpoint pool is readable — approximated).
  world.add(baby, Health, { hitpoints: DEFAULT_SETTLER_HITPOINTS, max: DEFAULT_SETTLER_HITPOINTS });
  const owner = world.tryGet(mother, Owner)?.player;
  if (owner !== undefined) {
    world.add(baby, Owner, { player: owner });
    stampDefaultStance(world, baby, world.get(baby, Settler).jobType);
  }
  world.add(baby, Residence, { home });
  world.get(mother, Marriage).child = baby;
  world.get(father, Marriage).child = baby;
  world.remove(mother, ChildOrder);
  world.remove(home, MakingLove);
  stepOut(world, mother);
  stepOut(world, father);
  ctx.events.emit({ kind: 'settlerBorn', entity: baby });
}
