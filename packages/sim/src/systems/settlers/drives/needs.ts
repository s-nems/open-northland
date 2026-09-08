import type { ContentSet } from '@open-northland/data';
import {
  hasMissionBehaviour,
  MISSION_BEHAVIOUR,
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
import { NEED_DRIVE_THRESHOLD, NEED_SATED_THRESHOLD } from '../../lifecycle/needs/index.js';
import { needAtomicDuration } from '../../readviews/animations.js';
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
// fires at the one shared NEED_DRIVE_THRESHOLD, the level a settler leaves its work at.

/**
 * Whether any needs rung would fire, so a caller can skip `planNeeds`'s target and limit setup for a sated
 * settler. The ladder re-checks each threshold, so this elides only provably-null work. Piety counts only
 * for a trade that prays: every other trade's bar can pin with nothing able to serve it. `ordered` is the
 * need the player told this settler to answer, which fires its rung whatever the bar reads.
 */
export function anyNeedPressing(
  content: ContentSet,
  settler: SettlerIdentity & { hunger: Fixed; fatigue: Fixed; piety: Fixed },
  ordered?: NeedKind,
): boolean {
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
 * The in-place half of the needs ladder, for a settler that must not move: {@link planNeeds}'s rung order
 * with every tail that walks or lies down removed.
 */
export function answerNeedInPlace(
  world: World,
  ctx: SystemContext,
  e: Entity,
  settler: SettlerIdentity & { hunger: Fixed; fatigue: Fixed },
): boolean {
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
  }
  if (pressing(settler.fatigue, ordered, 'fatigue')) {
    const draught = draughtSlotFor(world, ctx, e, 'fatigue');
    if (draught !== null) {
      startDrink(world, ctx, e, settler, draught);
      return true;
    }
    if (maySeek(world, e, ordered, 'fatigue') && sleepAtPost(world, ctx, e, settler)) return true;
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
): boolean {
  // A script may freeze a unit's needs: they neither rise nor get answered, so it never leaves its post
  // to eat, sleep or pray (`MISSIONS.md`, behaviour bit 0).
  if (hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.NEEDS_FROZEN)) return false;
  const gate = limit ?? undefined;
  const ordered = orderedNeed(world, e);
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
    const food = seek ? nearestFood(targets, world, ctx, terrain, here, e, gate) : null;
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
    // Hungry with no reachable food: fall through to work while hunger stays clamped at ONE and the
    // starvation bite drains the pool until food appears.
    topUpUnservedNeedForAi(world, e, 'hunger');
  }

  if (pressing(settler.fatigue, ordered, 'fatigue')) {
    // A stamina draught is drunk in place, replacing the walk to a bed: the manual's "remain awake and
    // ready longer". Kept on the bar rather than the order, as with the hunger flask above.
    const draught = settler.fatigue >= NEED_DRIVE_THRESHOLD ? draughtSlotFor(world, ctx, e, 'fatigue') : null;
    if (draught !== null) {
      startDrink(world, ctx, e, settler, draught);
      return true;
    }
    if (maySeek(world, e, ordered, 'fatigue')) {
      if (sleepAtPost(world, ctx, e, settler)) return true;
      if (sleepAtHome(world, ctx, terrain, e, settler, here, limit)) return true;
      atOrWalk(world, e, here, restingCell(world, ctx, terrain, e, here, spacing, limit), () =>
        startAtomic(
          world,
          e,
          SLEEP_ATOMIC_ID,
          { kind: 'sleep' },
          needAtomicDuration(ctx.content, settler, SLEEP_ATOMIC_ID),
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
    maySeek(world, e, ordered, 'piety');
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
          needAtomicDuration(ctx.content, settler, PRAY_ATOMIC_ID),
          temple,
        ),
      );
      return true;
    }
    // No temple reachable: fall through to work with piety pinned at ONE.
    topUpUnservedNeedForAi(world, e, 'piety');
  }

  return false;
}

/**
 * A computer seat's answer to a need its settlement cannot serve: the bar goes back to the level a served
 * need sits at instead of pinning, so a walled-off larder cannot starve a whole AI settlement. A human
 * player's settlers take the consequences instead. Approximation: no readable source states the rule.
 */
function topUpUnservedNeedForAi(world: World, e: Entity, need: 'hunger' | 'piety'): void {
  if (world.get(e, Settler)[need] <= NEED_SATED_THRESHOLD) return;
  const player = ownerOf(world, e);
  if (player === undefined || !isAiPlayer(world, player)) return;
  world.mut(e, Settler)[need] = NEED_SATED_THRESHOLD;
}
