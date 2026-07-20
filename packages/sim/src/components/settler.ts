import type { AtomicEffect } from '../core/atomic-effect.js';
import type { Fixed } from '../core/fixed.js';
import { defineComponent, type Entity } from '../ecs/world.js';
import type { NodeId } from '../nav/terrain/index.js';

/**
 * The `(tribe, job)` pair that keys a settler's content lookups — its weapon and armor class, its
 * allowed atomics, its animation set. A structural subset of {@link Settler}, so a `world.get(e, Settler)`
 * value assigns straight to it.
 */
export interface SettlerIdentity {
  readonly tribe: number;
  readonly jobType: number | null;
}

/**
 * A settler: an autonomous individual. Settlers don't "do jobs" as monolithic logic — they execute atomic
 * actions ({@link CurrentAtomic}) chosen by a planner; `jobType` constrains which atomics are allowed
 * (`jobtypes.allowatomic`), and `experience` keyed by specialization gates progression.
 */
export const Settler = defineComponent<{
  tribe: number;
  jobType: number | null;
  /** 0..ONE hunger; rises over time, NeedsSystem drives eating. */
  hunger: Fixed;
  /**
   * 0..ONE fatigue; rises over time like {@link hunger}. Satisfied by the `sleep` atomic (id 8, bound for
   * every job/tribe in `tribetypes` `setatomic <job> 8 "..._sleep"`), which the sleep drive runs on open
   * ground away from the buildings.
   */
  fatigue: Fixed;
  /**
   * 0..ONE piety — a target-bound need, satisfied by walking to a site rather than in place. Unlike
   * {@link hunger} it does not rise over time: only forging a weapon or armor good raises it, and the
   * `pray` atomic (id 12, `setatomic 6 12 "..._pray"`) at a temple clears it.
   */
  piety: Fixed;
  /**
   * 0..ONE enjoyment — the social/company need. Rises over time like {@link hunger}. The original restores
   * channel 3 (leisure/social) through the talk/monologuize/listen atomics 14/13/15 plus `enjoy` (17) and
   * `make_love` (78) — there is no building satisfier. The gossip drive (`systems/social/gossip/`) is the
   * satisfying half: settlers pair up and the talk/listen animation pulses refill this bar.
   * (Channels: 1 = rest, 2 = hunger, 3 = leisure/social.)
   */
  enjoyment: Fixed;
  /** specialization id -> experience points (humanjobexperiencetypes). */
  experience: Map<number, number>;
}>('Settler');

/**
 * Marks a settler whose eat drive went looking for food and found none in reach — a famine flag, not a
 * "this settler is hungry" flag. Stamped and cleared by the eat rung (`systems/agents/drives-needs.ts`)
 * each time it runs, so it stands exactly while the settler is over the eat threshold with nothing to
 * eat: a stocked larder or a ripe bush within reach clears it the tick the drive picks one.
 *
 * This is what the HUD's hunger bubble reads. In the original the icon means the village is starving,
 * not that someone is due a meal (observed original), and a settler crosses the eat threshold routinely
 * — so keying the bubble on the bar itself would light up half the map.
 */
export const FoodUnreachable = defineComponent<{ readonly noFood: true }>('FoodUnreachable');

/** The one {@link FoodUnreachable} component value — the marker carries no per-entity data. */
export const NO_FOOD = { noFood: true } as const;

/**
 * The atomic micro-action a settler is currently executing (the unit of behavior in Cultures, e.g.
 * pickup=22, harvest=24, eat=10, attack=81). The planner (AISystem) sets this; the AtomicSystem
 * advances `progress` from 0 to ONE over `duration` ticks, and on completion applies the typed
 * {@link AtomicEffect}, emits an `atomicCompleted` event, and removes the component — the planner sees an
 * entity with no CurrentAtomic as ready for its next atomic.
 *
 * `atomicId` keeps the numeric content cross-reference (the join key onto a tribe's `setatomic` animation);
 * `effect` is the typed action the executor applies. `duration` is the animation length in ticks
 * (`AtomicAnimation.length`, supplied by the planner) — at least 1, so a zero-length animation still
 * completes in exactly one tick. `targetEntity`/`targetTile` are the action's object. Timing runs off the
 * integer `elapsed`, never an accumulated fixed-point step: `ONE / duration` truncates, so a summed fraction
 * would never reach ONE and the atomic would hang.
 */
export const CurrentAtomic = defineComponent<{
  atomicId: number;
  /** Whole ticks executed so far; completion is the exact `elapsed >= duration`. */
  elapsed: number;
  /** Derived `elapsed/duration` in 0..ONE — for render interpolation only, not the completion test. */
  progress: Fixed;
  duration: number; // animation length in ticks (>= 1)
  effect: AtomicEffect;
  targetEntity: number | null;
  targetTile: { x: number; y: number } | null;
  /**
   * Present (true) only while the atomic runs its inter-swing rest tail: the harvest effect has applied and
   * its completion event fired, and the executor extended `duration` so the gatherer stands its breather in
   * the swing's ready pose (the effect stays the harvest so the tail chains straight into the next swing).
   * The tail completes silently — no `atomicCompleted` re-emit.
   */
  restTail?: boolean;
}>('CurrentAtomic');

/** A settler carrying goods (carriers physically haul; goods never teleport to a global bank). */
export const Carrying = defineComponent<{ goodType: number; amount: number }>('Carrying');

/** The most units a settler picks up in one lift — one, globally: a person carries a single good unit at a
 *  time (observed original behavior; no on-foot batch exists anywhere in the game). Hauling more takes more
 *  trips; a cart/vehicle slice would model the vehicle's own hold, never a bigger personal carry. */
export const CARRY_CAPACITY = 1;

/**
 * A builder's construction-site crew membership: the site this settler is raising. Stamped by the builder
 * drive whenever it engages a site (hammer / fetch / wait), so membership survives waiting for material, a
 * player detour, or a meal. `pinned` marks a player-made assignment (the `assignBuilder` right-click,
 * faithful to the original's "put a builder on a foundation"): a pinned site wins over the nearest-site pick
 * while it still stands. Cleared when the settler stops being a builder, no site remains, or the pinned site
 * finishes.
 */
export const SiteAssignment = defineComponent<{ site: Entity; pinned: boolean }>('SiteAssignment');

/**
 * A settler's live construction-supply errand: it is fetching (or hauling) `amount` of `goodType` toward
 * `site`. Stamped when the builder drive commits a fetch or the delivery drive routes a load to a site,
 * cleared at the top of the settler's own next planning (the rungs re-stamp it while the errand lasts), so it
 * persists through the walk/pickup/haul and dies with the errand. Later-planned settlers subtract these from
 * a site's outstanding need ({@link import('../systems/stores/supply-tally.js').InboundSupplyTally}), so two
 * builders don't race to fetch the same last unit and a crew spreads over different materials.
 */
export const SupplyRun = defineComponent<{ site: Entity; goodType: number; amount: number }>('SupplyRun');

/**
 * A worker→workplace binding: the specific {@link Building} a settler is employed at — the walk-to-workplace
 * drive heads for this building and the staffs-here pin latches the settler only on it, so two same-type
 * workplaces staff independently. The JobSystem assigns it when it employs an idle settler, picking a concrete
 * understaffed building rather than just a job type. Optional, so an unemployed settler simply has none; a
 * settler standing on a workplace it staffs but lacking a binding (e.g. spawned pre-employed) is adopted by
 * the JobSystem — bound to the building under its feet — so the binding stays authoritative.
 */
export const JobAssignment = defineComponent<{ workplace: Entity }>('JobAssignment');

/**
 * A settler's age in whole ticks while it is still a non-working life stage. Only a settler born young (the
 * FamilySystem's birth) carries one: the GrowthSystem increments it each tick and promotes the age-class
 * `jobType` (baby → child → adult-eligible) at each stage boundary, then removes the component once the
 * settler reaches adult-eligibility (`jobType` cleared to `null`). So an adult never carries an `Age`, and
 * every settler from `spawnSettler` (born adult) has none.
 */
export const Age = defineComponent<{ ticks: number }>('Age');

/**
 * A player move order in flight on a settler, stamped by
 * {@link import('../systems/orders/index.js').moveUnit}. While present the AISystem's ECONOMY branch and the
 * combat auto-drives leave the unit alone (the reposition is authoritative), but its NEEDS drives still fire.
 * The {@link import('../systems/orders/index.js').playerOrderSystem} removes it the tick the unit arrives (or
 * the route fails / a need takes over) — there is no post-arrival hold; DEFEND's stance anchor is the "hold
 * position" tool.
 *
 * `pendingGoal` holds a move order issued to a settler that was still carrying a load: it can't walk with its
 * hands full, so `moveUnit` starts the drop atomic and parks the destination node here, and the
 * {@link import('../systems/orders/index.js').playerOrderSystem} launches the walk (sets the {@link MoveGoal})
 * the tick the drop finishes, then clears the field. Absent on a move order issued to an empty-handed settler.
 */
export const PlayerOrder = defineComponent<{ pendingGoal?: NodeId }>('PlayerOrder');
