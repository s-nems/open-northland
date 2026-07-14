import type { AtomicEffect } from '../core/atomic-effect.js';
import type { Fixed } from '../core/fixed.js';
import { defineComponent, type Entity } from '../ecs/world.js';

/**
 * A settler: an autonomous individual. In Cultures, settlers don't "do jobs" as monolithic logic —
 * they execute ATOMIC actions (see CurrentAtomic) chosen by a planner. `jobType` constrains which
 * atomics are allowed (jobtypes.allowatomic); `experience` keyed by specialization gates progression.
 */
export const Settler = defineComponent<{
  tribe: number;
  jobType: number | null;
  /** 0..ONE hunger; rises over time, NeedsSystem drives eating. */
  hunger: Fixed;
  /**
   * 0..ONE fatigue; rises over time like {@link hunger}. The original satisfies it with the `sleep` atomic
   * (id 8, bound for every job/tribe in `tribetypes` `setatomic <job> 8 "..._sleep"`); the rest drive is a
   * later slice, so this field is the rise half only.
   */
  fatigue: Fixed;
  /**
   * 0..ONE piety — the first target-bound non-food need (satisfied by walking to a site, unlike eat at a
   * store or sleep in place). Rises over time like {@link hunger}. The original satisfies it with the `pray`
   * atomic (id 12, `setatomic 6 12 "..._pray"`) at a temple; the need→satisfier→building lookup is a later
   * slice, so this field is the rise half only. `enjoy` (17) / `make_love` (78) follow the same shape.
   */
  piety: Fixed;
  /**
   * 0..ONE enjoyment — the recreation/leisure need. Rises over time like {@link hunger}. The original
   * satisfies it with two atomics that both restore channel 3 (leisure): `enjoy` (id 17, `event <at> 3 +100`)
   * and `make_love` (id 78, civilist + woman jobs, `event <at> 3 +800`) — `make_love` is not a separate need,
   * it resets this same field. (Channels: 1 = rest, 2 = hunger, 3 = leisure.)
   *
   * Only the rise and the two resets are pinned: neither atomic has a readable building satisfier — the only
   * no-recipe/no-worker/no-stock houses in `houses.ini` are the temple and a decorative wall — so the drive
   * is deferred pending a content building→need binding.
   */
  enjoyment: Fixed;
  /** specialization id -> experience points (humanjobexperiencetypes). */
  experience: Map<number, number>;
}>('Settler');

/**
 * The atomic micro-action a settler is currently executing (the unit of behavior in Cultures, e.g.
 * pickup=22, harvest=24, eat=10, attack=81). The planner (AISystem) sets this; the AtomicSystem
 * advances `progress` from 0 to ONE over `duration` ticks, and on completion applies the typed
 * {@link AtomicEffect} (the state mutation), emits an `atomicCompleted` event, and removes the
 * component — the planner sees an entity with no CurrentAtomic as ready for its next atomic.
 *
 * `atomicId` keeps the numeric content cross-reference (the join key onto a tribe's `setatomic` animation);
 * `effect` is the typed action the executor applies, so the apply switch is exhaustive and golden traces stay
 * human-readable. `duration` is the animation length in ticks (`AtomicAnimation.length`, supplied by the
 * planner) — at least 1, so a zero-length animation still completes in exactly one tick.
 * `targetEntity`/`targetTile` are the action's object (the resource to harvest, the store to pile up at).
 *
 * Timing is driven by the integer `elapsed` tick counter, not by accumulating a fixed-point step: `ONE /
 * duration` truncates, so a fractional step summed `duration` times would never reach ONE and the atomic
 * would hang.
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

/**
 * A builder's construction-site crew membership: the site this settler is raising. Stamped by the builder
 * drive whenever it engages a site (hammer / fetch / wait), so membership survives waiting for material, a
 * player detour, or a meal, and the workers window lists the crew stably instead of flickering with each
 * atomic. `pinned` marks a player-made assignment (the `assignBuilder` right-click, faithful to the
 * original's "put a builder on a foundation"): a pinned site wins over the nearest-site pick while it still
 * stands. Cleared when the settler stops being a builder, no site remains, or the pinned site finishes.
 */
export const SiteAssignment = defineComponent<{ site: Entity; pinned: boolean }>('SiteAssignment');

/**
 * A settler's live construction-supply errand: it is fetching (or hauling) `amount` of `goodType` toward
 * `site`. Stamped when the builder drive commits a fetch or the delivery drive routes a load to a site,
 * cleared at the top of the settler's own next planning (the rungs re-stamp it while the errand lasts), so it
 * persists through the walk/pickup/haul and dies with the errand. Later-planned settlers subtract these from
 * a site's outstanding need ({@link import('../systems/stores/construction.js').inboundSupply}), so two
 * builders don't race to fetch the same last unit and a crew spreads over different materials.
 */
export const SupplyRun = defineComponent<{ site: Entity; goodType: number; amount: number }>('SupplyRun');

/**
 * A worker→workplace binding: the specific {@link Building} a settler is employed at, and the source of truth
 * for "which mill is mine" — the walk-to-workplace drive heads for this building and the staffs-here pin
 * latches the settler only on it, so two same-type workplaces staff independently. The JobSystem assigns it
 * when it employs an idle settler, picking a concrete understaffed building rather than just a job type.
 *
 * Optional, so an unemployed settler simply has none. A settler standing on a workplace it staffs but lacking
 * a binding (e.g. spawned pre-employed) is adopted by the JobSystem — bound to the building under its feet —
 * so the binding stays authoritative without a behavior change.
 */
export const JobAssignment = defineComponent<{ workplace: Entity }>('JobAssignment');

/**
 * A settler's age in whole ticks while it is still a non-working life stage. Only a settler born young (the
 * ReproductionSystem) carries one: the GrowthSystem increments it each tick and promotes the age-class
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
 * the route fails / a need takes over) — there is no post-arrival hold, so a unit resumes autonomy on
 * arrival; DEFEND's stance anchor is the "hold position" tool.
 */
export const PlayerOrder = defineComponent<Record<string, never>>('PlayerOrder');
