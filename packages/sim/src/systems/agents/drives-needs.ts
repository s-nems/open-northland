import type { SettlerIdentity } from '../../components/index.js';
import { type Fixed, fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { needAtomicDuration } from '../readviews/animations.js';
import { isFood } from '../readviews/index.js';
import type { NavigationLimit } from '../signposts/index.js';
import {
  atOrWalk,
  EAT_ATOMIC_ID,
  eatDuration,
  PRAY_ATOMIC_ID,
  SLEEP_ATOMIC_ID,
  startAtomic,
} from './actions.js';
import type { SpacingState } from './destack.js';
import { restingCell } from './rest-spot.js';
import { sleepAtHome } from './sleep-at-home.js';
import { interactionCell, nearestFood, nearestTemple, type TargetCandidates } from './targets/index.js';

// The NEEDS drives — the highest-priority rungs of the planner ladder (a starving operator leaves
// its workplace to feed rather than work itself to death). Order inside planNeeds is part of the
// design: eat > sleep > pray (survival outranks rest outranks devotion), and an unsatisfiable need
// FALLS THROUGH to normal work (the need stays clamped at ONE) rather than freezing the settler.

/**
 * Hunger level (fixed-point, in [0, ONE]) at or above which a settler stops working to eat. Set to
 * ¾ of a full bar: a settler works most of the way up the hunger bar, then seeks food before it
 * pins at ONE. APPROXIMATED (see source basis): the original drives eating off the per-animation
 * hunger events (`event 30 2 <delta>` in event units — the eat clip's one +4000 maps to a full bar,
 * the same 4000-unit scale gossip's SOCIAL_EVENT_UNITS_PER_BAR reads) with no single readable "go eat
 * at X" threshold; this constant is the slice's deterministic eat trigger until that vocabulary is
 * decoded and calibration-by-observation pins the real cadence. Exported for the gossip cancel check.
 */
export const HUNGER_EAT_THRESHOLD: Fixed = fx.div(fx.fromInt(3), fx.fromInt(4)); // ¾·ONE

/**
 * Hunger level at or above which the HUD floats the hunger bubble. It sits well above
 * {@link HUNGER_EAT_THRESHOLD} so a settler that can feed itself eats long before showing the icon;
 * reaching it means the eat drive has been firing for ~160 s at 1× without finding food. The bubble
 * therefore reports a famine in the settlement, not one settler being due a meal.
 *
 * Source basis: observed original — the icon appears when settlers have trouble finding food, not on
 * every meal (user observation). The exact fraction is approximated; it is set by the gap it leaves
 * above the eat trigger, not by a readable constant.
 */
export const HUNGER_BUBBLE_THRESHOLD: Fixed = fx.div(fx.fromInt(95), fx.fromInt(100));

/**
 * Fatigue level (fixed-point, in [0, ONE]) at or above which a settler stops working to sleep. Set to
 * ¾ of a full bar, mirroring {@link HUNGER_EAT_THRESHOLD}: a settler works most of the way up the
 * fatigue bar, then rests before it pins at ONE. APPROXIMATED (see source basis): like the eat
 * trigger, the original drives sleeping off the per-animation rest events (`event <at> 1 <delta>`)
 * with no single readable "sleep at X" threshold; this constant is the slice's deterministic sleep
 * trigger until that vocabulary is decoded and calibration-by-observation pins the real cadence.
 */
export const FATIGUE_SLEEP_THRESHOLD: Fixed = fx.div(fx.fromInt(3), fx.fromInt(4)); // ¾·ONE

/**
 * Fatigue level at or above which the HUD floats the sleepy bubble, mirroring
 * {@link HUNGER_BUBBLE_THRESHOLD}. Rest needs the gap even more than hunger does: fatigue crosses its
 * ¾ trigger every ~160 s and the settler then walks to a bed and sleeps a 237-tick clip, so keying the
 * icon on the drive trigger would leave a large share of the map permanently bubbling. Past this, the
 * settler has been unable to bed down — boxed in, or confined away from any open ground.
 */
export const FATIGUE_BUBBLE_THRESHOLD: Fixed = fx.div(fx.fromInt(95), fx.fromInt(100));

/**
 * Piety level (fixed-point, in [0, ONE]) at or above which a settler stops working to pray, mirroring
 * {@link HUNGER_EAT_THRESHOLD}/{@link FATIGUE_SLEEP_THRESHOLD} at ¾ of a full bar. Since piety no longer
 * rises over time — it climbs only when a smith forges a weapon/armor good (`chargeMilitaryPiety`) — in
 * practice only smiths reach this threshold; other trades keep their seeded starting piety and never pray.
 * APPROXIMATED (see source basis): like the eat/sleep triggers, the original drives praying off the
 * per-animation devotion events with no single readable "pray at X" threshold; this constant is the slice's
 * deterministic pray trigger until that vocabulary is decoded and calibration-by-observation lands.
 */
const PIETY_PRAY_THRESHOLD: Fixed = fx.div(fx.fromInt(3), fx.fromInt(4)); // ¾·ONE

/**
 * Whether any needs-ladder rung would fire for these need levels — the cheap pre-gate a caller uses to
 * skip {@link planNeeds}'s target/limit setup for a sated settler (the ladder re-checks each threshold,
 * so gating on this elides only provably-null work and can never change a pick).
 */
export function anyNeedPressing(needs: { hunger: Fixed; fatigue: Fixed; piety: Fixed }): boolean {
  return (
    needs.hunger >= HUNGER_EAT_THRESHOLD ||
    needs.fatigue >= FATIGUE_SLEEP_THRESHOLD ||
    needs.piety >= PIETY_PRAY_THRESHOLD
  );
}

/**
 * Run the needs ladder for one idle settler. Returns `true` when a drive acted (started an atomic or
 * set a walk goal — the settler is spoken for this tick), `false` when every need is either below its
 * threshold or unsatisfiable (no food anywhere, no temple) — the caller then falls through to combat
 * gates and economy work, with the unsatisfied bar staying clamped at ONE.
 *
 *  - **EAT** (highest): eat a carried edible on the spot, else walk to the NEAREST food of any kind
 *    ({@link nearestFood}) — a store holding food, or a ripe wild berry bush (the fallback) — and eat/
 *    forage it there. A settler that finds nothing keeps climbing to {@link HUNGER_BUBBLE_THRESHOLD},
 *    which is where the HUD's famine icon comes in.
 *  - **SLEEP** (below eat — a starving settler eats before it can rest): go home to bed when the settler
 *    has a house ({@link sleepAtHome}), else step off the workplace doorstep to open ground
 *    ({@link restingCell}) and sleep there.
 *  - **PRAY** (below eat + sleep — survival outranks devotion): the first **target-bound** need —
 *    walk to the nearest temple and pray on it ({@link nearestTemple}).
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
  /** The settler's signpost confinement, or null when unlimited — a hungry/devout settler only seeks a
   *  satisfier inside its allowed area (an unsatisfiable need falls through to work as ever). */
  limit: NavigationLimit | null,
  /** The planner-tick occupancy/claim state the sleep rung picks a bed out of ({@link restingCell}). */
  spacing: SpacingState,
): boolean {
  const gate = limit ?? undefined;
  if (settler.hunger >= HUNGER_EAT_THRESHOLD) {
    if (load !== undefined && load.amount > 0 && isFood(ctx, load.goodType)) {
      // Carrying food: eat a unit on the spot (consumed from the carried load).
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
    // Find the NEAREST food of any kind — a stocked/produced larder or a wild berry bush (the fallback
    // when no larder is near). The eat animation (id 10) is shared; only the completion EFFECT differs
    // (consume a stored unit vs forage a bush), so the walk-or-act tail is identical for both.
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
    // Hungry but no food anywhere reachable: fall through to normal work (the needs loop keeps
    // hunger clamped at ONE, and the NeedsSystem's starvation bite drains the pool until food appears).
    // The bar keeps climbing to HUNGER_BUBBLE_THRESHOLD, which is what raises the HUD's famine icon.
  }

  if (settler.fatigue >= FATIGUE_SLEEP_THRESHOLD) {
    // A settler with a house goes home to bed — the data gives that a clip of its own worth the same
    // rest in a fifth of the time (see {@link sleepAtHome}).
    if (sleepAtHome(world, ctx, terrain, e, settler, here, limit)) return true;
    // Homeless (or the house is gone / still a site / out of area): bed down in the open rather than
    // where the settler happens to be standing — it steps off the workplace doorstep first (see
    // {@link restingCell}); already out in the open, it sleeps on the spot.
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
    const temple = nearestTemple(targets.buildingCells, world, ctx, here, gate);
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
    // Devout but no temple reachable: fall through to normal work (piety stays pinned at ONE).
  }

  return false;
}
