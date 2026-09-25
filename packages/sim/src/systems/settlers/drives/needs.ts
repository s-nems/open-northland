import type { ContentSet } from '@open-northland/data';
import {
  Carrying,
  isAiPlayer,
  type NeedKind,
  NeedOrder,
  NoRegeneration,
  ownerOf,
  Settler,
  type SettlerIdentity,
} from '../../../components/index.js';
import type { Fixed } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import {
  carriesNeeds,
  drinkPressingDraughts,
  NEED_CRITICAL_THRESHOLD,
  NEED_DRIVE_THRESHOLD,
  NEED_SATED_THRESHOLD,
} from '../../lifecycle/needs/index.js';
import { atomicDuration } from '../../readviews/animations.js';
import { isFood, jobNeedsReligion } from '../../readviews/index.js';
import type { NavigationLimit } from '../../signposts/index.js';
import {
  atOrWalk,
  EAT_ATOMIC_ID,
  eatDuration,
  PRAY_ATOMIC_ID,
  SLEEP_ATOMIC_ID,
  startAtomic,
} from '../atomics/start.js';
import type { PlannerSpacing } from '../planner/spacing.js';
import { interactionCell, nearestFood, nearestPrayerSite, type TargetCandidates } from '../targets/index.js';
import { unreachableGoalVeto } from '../unreachable-goals.js';
import { prayAtHome, sleepAtHome } from './home-errands.js';
import { restingCell } from './rest-spot.js';
import { eatAtPost, sleepAtPost } from './tower-post.js';

// The needs drives: the highest-priority rungs of the planner ladder. Eat outranks sleep outranks pray,
// and an unsatisfiable need falls through to normal work rather than freezing the settler. Every rung
// fires at the one shared NEED_DRIVE_THRESHOLD, the level a settler leaves its work at. On a computer
// seat a seek that fails writes the sated level over its bar instead (`settleUnservedNeedForAi`).
// Only a settler whose bars move answers them at all ({@link carriesNeeds}): a hero, or a unit whose needs
// a script froze (`MISSIONS.md`, behaviour bit 0), would otherwise spend what it eats on a bar that stays.

/**
 * Whether any needs rung would fire for `e`. Piety counts only for a trade that prays: every other
 * trade's bar can pin with nothing able to serve it. A need the player ordered fires its rung whatever
 * the bar reads.
 */
export function anyNeedPressing(world: World, content: ContentSet, e: Entity): boolean {
  if (!carriesNeeds(world, content, e)) return false;
  const settler = world.get(e, Settler);
  const ordered = orderedNeed(world, e);
  return (
    ordered !== undefined ||
    settler.hunger >= NEED_DRIVE_THRESHOLD ||
    settler.fatigue >= NEED_DRIVE_THRESHOLD ||
    (settler.piety >= NEED_DRIVE_THRESHOLD && jobNeedsReligion(content, settler.jobType))
  );
}

/** The need the player ordered this settler to answer now, or undefined. */
export function orderedNeed(world: World, e: Entity): NeedKind | undefined {
  return world.tryGet(e, NeedOrder)?.need;
}

/**
 * Whether `need`'s rung fires at all: the bar is over its threshold, or the player ordered that need
 * answered.
 */
function pressing(level: Fixed, ordered: NeedKind | undefined, need: NeedKind): boolean {
  return ordered === need || level >= NEED_DRIVE_THRESHOLD;
}

/**
 * Whether the settler may go looking for what `need` wants rather than answer it from what it carries.
 * A soldier whose regeneration the player prohibited may not, and an explicit order overrides that -
 * which is how the original gates its own need task on the refresh-in-world flag.
 */
function maySeek(world: World, e: Entity, ordered: NeedKind | undefined, need: NeedKind): boolean {
  return ordered === need || !world.has(e, NoRegeneration);
}

/** The hunger and fatigue bars once carried draughts have answered them. */
function barsAfterDraughts(world: World, ctx: SystemContext, e: Entity): { hunger: Fixed; fatigue: Fixed } {
  drinkPressingDraughts(world, ctx, e);
  return world.get(e, Settler);
}

/**
 * The in-place half of the needs ladder, for a settler that must hold its ground: {@link planNeeds}'s rung
 * order with every tail that walks or lies down removed, a tower's bed included, so fatigue no draught
 * answers waits for the end of the fight.
 *
 * What is left to answer with is thin on purpose: a garrison eats from its tower, and a field unit eats
 * only what it happens to carry. A unit locked in a fight it cannot win before its hunger kills
 * it is the player's to pull out, with a move order or an ordered meal; both break the fight off.
 */
export function answerNeedInPlace(
  world: World,
  ctx: SystemContext,
  e: Entity,
  settler: SettlerIdentity,
): boolean {
  if (!carriesNeeds(world, ctx.content, e)) return false;
  const ordered = orderedNeed(world, e);
  const bars = barsAfterDraughts(world, ctx, e);
  if (pressing(bars.hunger, ordered, 'hunger')) {
    const seek = maySeek(world, e, ordered, 'hunger');
    if (seek && eatCarried(world, ctx, e, settler, world.tryGet(e, Carrying))) return true;
    if (seek && eatAtPost(world, ctx, e, settler)) return true;
    if (seek) settleUnservedNeedForAi(world, e, 'hunger');
  }
  if (pressing(bars.fatigue, ordered, 'fatigue') && maySeek(world, e, ordered, 'fatigue')) {
    settleUnservedNeedForAi(world, e, 'fatigue');
  }
  return false;
}

/** Eat one unit of carried food where the settler stands; false when it carries none. */
function eatCarried(
  world: World,
  ctx: SystemContext,
  e: Entity,
  settler: SettlerIdentity,
  load: { goodType: number; amount: number } | undefined,
): boolean {
  if (load === undefined || load.amount <= 0 || !isFood(ctx, load.goodType)) return false;
  startAtomic(
    world,
    e,
    EAT_ATOMIC_ID,
    { kind: 'eat', goodType: load.goodType, from: null },
    eatDuration(ctx, settler),
    e,
  );
  return true;
}

/**
 * Run the needs ladder for one idle settler: carried draughts, then eat, sleep and pray. Returns true when
 * a rung acted and the settler is spoken for this tick, false when every need is below its threshold or
 * unsatisfiable, in which case the caller falls through to work with the unsatisfied bar clamped at ONE.
 *
 * A settler on alert answers a need in place, as {@link answerNeedInPlace} does, except that it walks to
 * food once its hunger turns critical: hunger alone costs hitpoints, so a standoff that never comes to
 * blows cannot starve a unit that is free to go. One the fight itself holds is answered in place at any
 * level, which is where an army can still starve. `onAlert` is asked only where its answer decides a walk,
 * a bed or a prayer.
 */
export function planNeeds(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  settler: SettlerIdentity & { piety: Fixed },
  here: NodeId,
  load: { goodType: number; amount: number } | undefined,
  targets: TargetCandidates,
  /** The settler's signpost confinement; a need is only sought inside it. */
  limit: NavigationLimit | null,
  /** The planner-tick occupancy state the sleep rung picks a resting spot out of. */
  spacing: PlannerSpacing,
  /** Memoized by the caller: the answer costs a presence sweep. */
  onAlert: () => boolean,
): boolean {
  if (!carriesNeeds(world, ctx.content, e)) {
    // An order stamped before a script froze the settler would otherwise stand for good.
    world.remove(e, NeedOrder);
    return false;
  }
  const gate = limit ?? undefined;
  const ordered = orderedNeed(world, e);
  const bars = barsAfterDraughts(world, ctx, e);
  if (pressing(bars.hunger, ordered, 'hunger')) {
    const seek = maySeek(world, e, ordered, 'hunger');
    if (seek && eatCarried(world, ctx, e, settler, load)) return true;
    if (seek && eatAtPost(world, ctx, e, settler)) return true;
    // A larder and a wild berry bush share the eat animation; only the completion effect differs, so the
    // walk-or-act tail below is identical for both.
    const walks = seek && (bars.hunger >= NEED_CRITICAL_THRESHOLD || !onAlert());
    const food = walks ? nearestFood(targets, world, ctx, terrain, here, e, gate) : null;
    if (food !== null) {
      const target = food.kind === 'store' ? food.store : food.bush;
      const effect =
        food.kind === 'store'
          ? ({ kind: 'eat', goodType: food.goodType, from: food.store } as const)
          : ({ kind: 'forage', bush: food.bush } as const);
      atOrWalk(world, e, here, interactionCell(world, ctx, terrain, target, here), () =>
        startAtomic(world, e, EAT_ATOMIC_ID, effect, eatDuration(ctx, settler), target),
      );
      return true;
    }
    // Hungry with no reachable food, or forbidden to look: a human seat's settler falls through to
    // work while hunger climbs to ONE and the starvation bite drains the pool until food appears. A
    // settler holding its ground never looked, so nothing failed to settle.
    if (walks) settleUnservedNeedForAi(world, e, 'hunger');
  }

  if (pressing(bars.fatigue, ordered, 'fatigue')) {
    if (maySeek(world, e, ordered, 'fatigue') && !onAlert()) {
      if (sleepAtPost(world, ctx, e, settler)) return true;
      if (sleepAtHome(world, ctx, terrain, e, settler, here, limit)) return true;
      atOrWalk(world, e, here, restingCell(world, ctx, terrain, e, here, spacing, limit), () =>
        startAtomic(
          world,
          e,
          SLEEP_ATOMIC_ID,
          { kind: 'sleep' },
          atomicDuration(ctx.content, settler, SLEEP_ATOMIC_ID),
          e,
        ),
      );
      return true;
    }
  }

  // A trade that does not pray has no prayer rung of its own; a player's order gives it one.
  const prays =
    pressing(settler.piety, ordered, 'piety') &&
    (ordered === 'piety' || jobNeedsReligion(ctx.content, settler.jobType)) &&
    maySeek(world, e, ordered, 'piety') &&
    !onAlert();
  if (prays) {
    if (prayAtHome(world, ctx, terrain, e, settler, here, limit)) return true;
    const site = nearestPrayerSite(
      targets.bands,
      world,
      here,
      ownerOf(world, e),
      gate,
      unreachableGoalVeto(world, ctx, e),
    );
    if (site !== null) {
      atOrWalk(world, e, here, interactionCell(world, ctx, terrain, site, here), () =>
        startAtomic(
          world,
          e,
          PRAY_ATOMIC_ID,
          { kind: 'pray' },
          atomicDuration(ctx.content, settler, PRAY_ATOMIC_ID),
          site,
        ),
      );
      return true;
    }
    // Nowhere to pray: a human seat's settler falls through to work with piety pinned at ONE, and its
    // player hears of it.
    if (!settleUnservedNeedForAi(world, e, 'piety'))
      ctx.events.emit({ kind: 'prayerSiteMissing', entity: e });
  }

  return false;
}

/**
 * A computer seat's answer to a need its settler went looking to serve and could not - nothing to eat
 * in reach, no bed, no temple: the bar goes back to the level a served need sits at instead of
 * pinning. Original behavior: a failed need seek sets the failed need's bar to the sated
 * level when the human's player is of the computer type, where a human player's settler gets the
 * warning message instead. A seek the seat
 * forbade starts no task there, so that bar falls to the seat's refill (`lifecycle/needs`). Returns false
 * when the bar still presses and the settler's player is the one to be warned.
 */
function settleUnservedNeedForAi(world: World, e: Entity, need: 'hunger' | 'fatigue' | 'piety'): boolean {
  if (world.get(e, Settler)[need] <= NEED_SATED_THRESHOLD) return true;
  const player = ownerOf(world, e);
  if (player === undefined || !isAiPlayer(world, player)) return false;
  world.mut(e, Settler)[need] = NEED_SATED_THRESHOLD;
  return true;
}
