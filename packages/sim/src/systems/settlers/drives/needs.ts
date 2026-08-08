import { Carrying, ownerOf, type SettlerIdentity } from '../../../components/index.js';
import { type Fixed, fx } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { needAtomicDuration } from '../../readviews/animations.js';
import { isFood } from '../../readviews/index.js';
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
// and an unsatisfiable need falls through to normal work rather than freezing the settler.

/**
 * Hunger (fixed-point, in [0, ONE]) at or above which a settler stops working to eat, at ¾ of a full bar.
 * Approximation: the original drives eating off per-animation hunger events (`event 30 2 <delta>`, where
 * the eat clip's +4000 maps to a full bar) with no single readable "go eat at X" threshold.
 */
export const HUNGER_EAT_THRESHOLD: Fixed = fx.div(fx.fromInt(3), fx.fromInt(4)); // ¾·ONE

/**
 * Hunger at or above which the HUD floats the hunger bubble. The gap above the eat trigger means the icon
 * marks a settler that cannot feed itself where it stands - out of reach of food, or engaged and out of
 * rations - rather than one merely due a meal. Source basis: observation of the original, where the icon
 * appears when settlers have trouble finding food; the fraction itself is an approximation.
 */
export const HUNGER_BUBBLE_THRESHOLD: Fixed = fx.div(fx.fromInt(95), fx.fromInt(100));

/**
 * Fatigue at or above which a settler stops working to sleep, at ¾ of a full bar. Approximation on the same
 * basis as `HUNGER_EAT_THRESHOLD`: the original drives sleeping off per-animation rest events
 * (`event <at> 1 <delta>`) with no single readable threshold.
 */
export const FATIGUE_SLEEP_THRESHOLD: Fixed = fx.div(fx.fromInt(3), fx.fromInt(4)); // ¾·ONE

/**
 * Fatigue at or above which the HUD floats the sleepy bubble. Settlers cross the ¾ sleep trigger often
 * enough that keying the icon on it would leave a large share of the map permanently bubbling; past this,
 * the settler has been unable to bed down at all.
 */
export const FATIGUE_BUBBLE_THRESHOLD: Fixed = fx.div(fx.fromInt(95), fx.fromInt(100));

/**
 * Piety at or above which a settler stops working to pray, at ¾ of a full bar. Only a smith's piety rises,
 * so in practice only smiths reach it. Approximation on the same basis as the eat and sleep triggers.
 */
const PIETY_PRAY_THRESHOLD: Fixed = fx.div(fx.fromInt(3), fx.fromInt(4)); // ¾·ONE

/**
 * Whether any needs rung would fire, so a caller can skip `planNeeds`'s target and limit setup for a sated
 * settler. The ladder re-checks each threshold, so this elides only provably-null work.
 */
export function anyNeedPressing(needs: { hunger: Fixed; fatigue: Fixed; piety: Fixed }): boolean {
  return (
    needs.hunger >= HUNGER_EAT_THRESHOLD ||
    needs.fatigue >= FATIGUE_SLEEP_THRESHOLD ||
    needs.piety >= PIETY_PRAY_THRESHOLD
  );
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
  if (settler.hunger >= HUNGER_EAT_THRESHOLD) {
    if (eatCarried(world, ctx, e, settler, world.tryGet(e, Carrying))) return true;
    const draught = draughtSlotFor(world, ctx, e, 'hunger');
    if (draught !== null) {
      startDrink(world, ctx, e, settler, draught);
      return true;
    }
    if (eatAtPost(world, ctx, e, settler)) return true;
  }
  if (settler.fatigue >= FATIGUE_SLEEP_THRESHOLD) {
    const draught = draughtSlotFor(world, ctx, e, 'fatigue');
    if (draught !== null) {
      startDrink(world, ctx, e, settler, draught);
      return true;
    }
    if (sleepAtPost(world, ctx, e, settler)) return true;
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
  const gate = limit ?? undefined;
  if (settler.hunger >= HUNGER_EAT_THRESHOLD) {
    if (eatCarried(world, ctx, e, settler, load)) return true;
    // A carried draught is drunk in place, replacing the walk to food, which is what the manual sells it
    // as: "cover longer distances without needing food". It ranks below food in hand, which is free.
    const draught = draughtSlotFor(world, ctx, e, 'hunger');
    if (draught !== null) {
      startDrink(world, ctx, e, settler, draught);
      return true;
    }
    if (eatAtPost(world, ctx, e, settler)) return true;
    // A larder and a wild berry bush share the eat animation; only the completion effect differs, so the
    // walk-or-act tail below is identical for both.
    const food = nearestFood(targets, world, ctx, terrain, here, e, gate);
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
  }

  if (settler.fatigue >= FATIGUE_SLEEP_THRESHOLD) {
    // A stamina draught is drunk in place, replacing the walk to a bed: the manual's "remain awake and
    // ready longer".
    const draught = draughtSlotFor(world, ctx, e, 'fatigue');
    if (draught !== null) {
      startDrink(world, ctx, e, settler, draught);
      return true;
    }
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

  if (settler.piety >= PIETY_PRAY_THRESHOLD) {
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
  }

  return false;
}
