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
import { interactionCell, nearestFood, nearestTemple, type TargetCandidates } from '../targets/index.js';
import { unreachableGoalVeto } from '../unreachable-goals.js';
import { draughtSlotFor, startDrink } from './drink.js';
import { restingCell } from './rest-spot.js';
import { sleepAtHome } from './sleep-at-home.js';
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

/**
 * The in-place half of the needs ladder, for a settler that must hold its ground: {@link planNeeds}'s rung
 * order with every tail that walks or lies down removed, a tower's bed included, so fatigue waits for a
 * stamina draught or the end of the fight.
 *
 * What is left to answer with is thin on purpose, and thinner still on extracted content, which binds no
 * equipment class to a good and so offers no draught at all: a garrison eats from its tower, and a field
 * unit eats only what it happens to carry. A unit locked in a fight it cannot win before its hunger kills
 * it is the player's to pull out, with a move order or an ordered meal; both break the fight off.
 */
export function answerNeedInPlace(
  world: World,
  ctx: SystemContext,
  e: Entity,
  settler: SettlerIdentity & { hunger: Fixed; fatigue: Fixed },
): boolean {
  if (!carriesNeeds(world, ctx.content, e)) return false;
  const ordered = orderedNeed(world, e);
  if (pressing(settler.hunger, ordered, 'hunger')) {
    const seek = maySeek(world, e, ordered, 'hunger');
    if (seek && eatCarried(world, ctx, e, settler, world.tryGet(e, Carrying))) return true;
    const draught = draughtSlotFor(world, ctx, e, 'hunger');
    if (draught !== null) {
      startDrink(world, ctx, e, settler, draught);
      return true;
    }
    if (seek && eatAtPost(world, ctx, e, settler)) return true;
    if (seek) settleUnservedNeedForAi(world, e, 'hunger');
  }
  if (pressing(settler.fatigue, ordered, 'fatigue')) {
    const draught = draughtSlotFor(world, ctx, e, 'fatigue');
    if (draught !== null) {
      startDrink(world, ctx, e, settler, draught);
      return true;
    }
    if (maySeek(world, e, ordered, 'fatigue')) settleUnservedNeedForAi(world, e, 'fatigue');
  }
  return false;
}

/** Eat one unit of carried food where the settler stands; false when it carries none. */
function eatCarried(
  world: World,
  ctx: SystemContext,
  e: Entity,
  settler: SettlerIdentity & { hunger: Fixed },
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
 * Run the needs ladder for one idle settler: eat, then sleep, then pray. Returns true when a rung acted and
 * the settler is spoken for this tick, false when every need is below its threshold or unsatisfiable, in
 * which case the caller falls through to work with the unsatisfied bar clamped at ONE.
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
  settler: SettlerIdentity & { hunger: Fixed; fatigue: Fixed; piety: Fixed },
  here: NodeId,
  load: { goodType: number; amount: number } | undefined,
  targets: TargetCandidates,
  /** The settler's signpost confinement; a need is only sought inside it. */
  limit: NavigationLimit | null,
  /** The planner-tick occupancy state the sleep rung picks a resting spot out of. */
  spacing: PlannerSpacing,
  onAlert: () => boolean,
): boolean {
  if (!carriesNeeds(world, ctx.content, e)) return false;
  const gate = limit ?? undefined;
  const ordered = orderedNeed(world, e);
  let alerted: boolean | undefined;
  const alert = (): boolean => {
    alerted ??= onAlert();
    return alerted;
  };
  if (pressing(settler.hunger, ordered, 'hunger')) {
    const seek = maySeek(world, e, ordered, 'hunger');
    if (seek && eatCarried(world, ctx, e, settler, load)) return true;
    // A carried draught is drunk in place, replacing the walk to food, which is what the manual sells it
    // as: "cover longer distances without needing food". It ranks below food in hand, which is free.
    // Kept on the bar rather than the order, so an ordered meal drains no flask the settler does not need.
    const draught = settler.hunger >= NEED_DRIVE_THRESHOLD ? draughtSlotFor(world, ctx, e, 'hunger') : null;
    if (draught !== null) {
      startDrink(world, ctx, e, settler, draught);
      return true;
    }
    if (seek && eatAtPost(world, ctx, e, settler)) return true;
    // A larder and a wild berry bush share the eat animation; only the completion effect differs, so the
    // walk-or-act tail below is identical for both.
    const walks = seek && (settler.hunger >= NEED_CRITICAL_THRESHOLD || !alert());
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

  if (pressing(settler.fatigue, ordered, 'fatigue')) {
    // A stamina draught is drunk in place, replacing the walk to a bed: the manual's "remain awake and
    // ready longer". Kept on the bar rather than the order, as with the hunger flask above.
    const draught = settler.fatigue >= NEED_DRIVE_THRESHOLD ? draughtSlotFor(world, ctx, e, 'fatigue') : null;
    if (draught !== null) {
      startDrink(world, ctx, e, settler, draught);
      return true;
    }
    if (maySeek(world, e, ordered, 'fatigue') && !alert()) {
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
    !alert();
  if (prays) {
    const temple = nearestTemple(
      targets.bands,
      world,
      here,
      ownerOf(world, e),
      gate,
      unreachableGoalVeto(world, ctx, e),
    );
    if (temple !== null) {
      atOrWalk(world, e, here, interactionCell(world, ctx, terrain, temple, here), () =>
        startAtomic(
          world,
          e,
          PRAY_ATOMIC_ID,
          { kind: 'pray' },
          atomicDuration(ctx.content, settler, PRAY_ATOMIC_ID),
          temple,
        ),
      );
      return true;
    }
    // No temple reachable: a human seat's settler falls through to work with piety pinned at ONE.
    settleUnservedNeedForAi(world, e, 'piety');
  }

  return false;
}

/**
 * A computer seat's answer to a need its settler went looking to serve and could not - nothing to eat
 * in reach, no bed, no temple: the bar goes back to the level a served need sits at instead of
 * pinning. Original behavior: a failed need seek sets the failed need's bar to the sated
 * level when the human's player is of the computer type, where a human player's settler gets the
 * warning message instead. A seek the seat
 * forbade starts no task there, so that bar falls to the seat's refill (`lifecycle/needs`).
 */
function settleUnservedNeedForAi(world: World, e: Entity, need: 'hunger' | 'fatigue' | 'piety'): void {
  if (world.get(e, Settler)[need] <= NEED_SATED_THRESHOLD) return;
  const player = ownerOf(world, e);
  if (player === undefined || !isAiPlayer(world, player)) return;
  world.mut(e, Settler)[need] = NEED_SATED_THRESHOLD;
}
