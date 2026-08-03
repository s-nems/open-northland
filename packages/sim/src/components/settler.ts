import type { AtomicEffect } from '../core/atomic-effect.js';
import type { Command } from '../core/commands/index.js';
import type { Fixed } from '../core/fixed.js';
import { defineComponent, type Entity, type World } from '../ecs/world.js';
import type { NodeId } from '../nav/terrain/index.js';

/**
 * The `(tribe, job)` pair that keys a settler's content lookups. A structural subset of {@link Settler},
 * so a `Settler` value assigns straight to it.
 */
export interface SettlerIdentity {
  readonly tribe: number;
  readonly jobType: number | null;
}

/**
 * An autonomous individual. `jobType` constrains which atomics it may run (`jobtypes.allowatomic`), and
 * `experience` keyed by specialization gates progression.
 */
export const Settler = defineComponent<{
  readonly tribe: number;
  /** Written only through {@link setSettlerJob}. */
  readonly jobType: number | null;
  /** 0..ONE; rises over time. */
  hunger: Fixed;
  /** 0..ONE; rises over time, cleared by the `sleep` atomic (id 8, `tribetypes` `setatomic <job> 8`). */
  fatigue: Fixed;
  /**
   * 0..ONE; does not rise with time - only forging a weapon or armor good raises it, and the `pray` atomic
   * (id 12, `setatomic 6 12`) at a temple clears it.
   */
  piety: Fixed;
  /**
   * 0..ONE; rises over time and is restored only by the talk/monologuize/listen atomics (14/13/15), never
   * by a building (the original's channel 3, leisure/social).
   */
  enjoyment: Fixed;
  /** specialization id -> experience points (humanjobexperiencetypes). */
  experience: Map<number, number>;
}>('Settler');

/** The write view of {@link Settler}'s otherwise-`readonly` trade, held only by {@link setSettlerJob}. */
type SettlerTradeWrite = { jobType: number | null };

/**
 * The one write path for `Settler.jobType` (`null` = idle): the in-place write is invisible to the
 * membership generation, so it bumps the value generation the alive-jobs table is keyed on.
 */
export function setSettlerJob(world: World, entity: Entity, jobType: number | null): void {
  world.write(entity, Settler, (s) => {
    (s as SettlerTradeWrite).jobType = jobType;
  });
}

/**
 * The atomic micro-action a settler is currently executing. The planner sets it; the AtomicSystem applies
 * the {@link AtomicEffect} on completion and removes the component, so an entity carrying none is ready
 * for its next atomic. Timing runs off the integer `elapsed`, never an accumulated fixed-point step:
 * `ONE / duration` truncates, so a summed fraction would never reach ONE and the atomic would hang.
 */
export const CurrentAtomic = defineComponent<{
  /** Join key onto a tribe's `setatomic` animation. */
  atomicId: number;
  /** Whole ticks executed so far; completion is the exact `elapsed >= duration`. */
  elapsed: number;
  /** Derived `elapsed/duration` in 0..ONE - for render interpolation only, not the completion test. */
  progress: Fixed;
  duration: number; // animation length in ticks (>= 1)
  effect: AtomicEffect;
  targetEntity: number | null;
  targetTile: { x: number; y: number } | null;
  /** Present only while the atomic runs its inter-swing rest tail: the harvest effect has already applied,
   *  and the tail completes without re-emitting `atomicCompleted`. */
  restTail?: boolean;
  /** Swings landed since the last breather, counted per worker rather than off the node's counters (an
   *  expert's swing advances those by more than one). Absent outside a harvest burst. */
  swingsSinceRest?: number;
  /** Fractional work credit banked across a multi-swing harvest, in [0, ONE); absent while whole. */
  workCredit?: Fixed;
}>('CurrentAtomic');

/** Goods a settler is physically hauling; goods never teleport to a global bank. */
export const Carrying = defineComponent<{ goodType: number; amount: number }>('Carrying');

/** The most units a settler picks up in one lift. Observation: a person carries a single good unit at a
 *  time, so hauling more takes more trips. */
export const CARRY_CAPACITY = 1;

/**
 * A builder's construction-site crew membership, re-stamped whenever the builder drive engages the site, so
 * it survives waiting for material, a player detour, or a meal. `pinned` marks a player-made assignment
 * (the `assignBuilder` order), which wins over the nearest-site pick while that site still stands.
 */
export const SiteAssignment = defineComponent<{ site: Entity; pinned: boolean }>('SiteAssignment');

/**
 * A settler's live construction-supply errand. Cleared at the top of its own next planning pass and
 * re-stamped while the errand lasts. Later-planned settlers subtract these from a site's outstanding need,
 * so two builders don't race for the same last unit and a crew spreads over different materials.
 */
export const SupplyRun = defineComponent<{ site: Entity; goodType: number; amount: number }>('SupplyRun');

/**
 * The specific {@link Building} a settler is employed at, so two same-type workplaces staff independently.
 * Only the `assignWorker` order stamps it; nothing else employs a settler.
 */
export const JobAssignment = defineComponent<{ workplace: Entity }>('JobAssignment');

/**
 * A settler's age in whole ticks while it is still a non-working life stage. Only a settler born young
 * carries one; the GrowthSystem promotes the age-class `jobType` at each stage boundary and removes the
 * component at adult-eligibility, so an adult never carries an `Age`.
 */
export const Age = defineComponent<{ ticks: number }>('Age');

/**
 * A player move order in flight on a settler. While present the planner's economy branch and the combat
 * auto-drives leave the unit alone, but its needs drives still fire; `playerOrderSystem` removes it on
 * arrival, on route failure, or when a need takes over.
 *
 * `pendingGoal` parks the destination while a settler that was carrying a load runs its drop atomic.
 * `attackMove` marks the aggressive flavour ({@link AttackMoveMarch}).
 */
export const PlayerOrder = defineComponent<{
  pendingGoal?: NodeId;
  attackMove?: AttackMoveMarch;
}>('PlayerOrder');

/**
 * The march an attack-move order walks out - the original's "Attack Position" (`misclogic/48`). Unlike a
 * plain move order it does not suppress the combat auto-drives: the unit walks under `MILITARY_MODE.ATTACK`
 * whatever its own stance says. Approximation: the original's en-route behaviour is unobserved, and its
 * vocabulary scopes the modes to soldiers (`misclogic/38-40`), so here an ordered civilian fights too.
 *
 * `goal` outlives a fight overwriting the {@link MoveGoal} with chase destinations; `resume` re-issues it
 * exactly once when the unit next falls idle, since a re-aimed goal makes an arrival test unusable;
 * `blockedUntil` rests the aggression through a tick whose chase could not route.
 */
export interface AttackMoveMarch {
  readonly goal: NodeId;
  resume: boolean;
  blockedUntil: number;
}

/** The order kinds a running non-interruptible atomic parks instead of cancelling (see {@link DeferredOrder}). */
export type DeferrableOrderCommand = Extract<
  Command,
  { kind: 'moveUnit' | 'attackMoveUnit' | 'setJob' | 'placeSignpost' }
>;

/**
 * A gameplay order parked behind a non-interruptible atomic instead of cancelling it; `deferredOrderSystem`
 * re-dispatches it once the atomic completes. One slot per settler, latest-order-wins - an approximation,
 * since the original's queueing depth under back-to-back orders is unobserved.
 */
export const DeferredOrder = defineComponent<{ command: DeferrableOrderCommand }>('DeferredOrder');
