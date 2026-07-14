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
   * (id 8, bound for every job/tribe in `tribetypes` `setatomic <job> 8 "..._sleep"`). The rest drive (a
   * settler heading off to sleep when fatigue crosses a threshold) is a later slice; this field is the rise half.
   */
  fatigue: Fixed;
  /**
   * 0..ONE piety — the first target-bound non-food need (a settler must walk to a site to satisfy it, unlike
   * eat at a store or sleep in place). Rises over time like {@link hunger}. The original satisfies it with
   * the `pray` atomic (id 12, `setatomic 6 12 "..._pray"`) run at a temple — the need→satisfier→building
   * lookup is the new piece the drive introduces (a later slice); this field is the rise half. The other
   * target-bound needs (`enjoy` id 17 / `make_love` id 78) follow the same shape.
   */
  piety: Fixed;
  /**
   * 0..ONE enjoyment — the recreation/leisure need. Rises over time like {@link hunger}. The original
   * satisfies it with two atomics that both restore channel 3 (leisure): `enjoy` (id 17,
   * `setatomic 6 17 "..._civilist_enjoy"`, `event <at> 3 +100`) and `make_love` (id 78, bound for the
   * civilist + woman jobs, `event <at> 3 +800` — a bigger boost); `make_love` is not a separate need, it
   * resets this same field. (channels: 1 = rest, 2 = hunger, 3 = leisure.) Unlike piety (satisfied at a
   * temple), neither has a readable building satisfier — the only no-recipe/no-worker/no-stock houses in
   * `houses.ini` are the temple and a decorative wall, neither a leisure site — so the drive is deferred
   * pending a content building→need binding; only the rise + the two resets are pinned (source basis).
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
 * `atomicId` keeps the numeric content cross-reference (fidelity / the join key onto a tribe's
 * `setatomic` animation); `effect` is the typed action the executor applies, so the apply switch is
 * exhaustive and golden traces are human-readable rather than opaque ints. `duration` is the
 * animation length in ticks (`AtomicAnimation.length`, supplied by the planner) — at least 1, so a
 * zero-length animation still completes in exactly one tick. `targetEntity`/`targetTile` are the
 * action's object (the resource to harvest, the store to pile up at).
 *
 * Timing is driven by the INTEGER `elapsed` tick counter, not by accumulating a fixed-point step:
 * `ONE / duration` truncates (e.g. ONE/3), so a fractional step summed `duration` times would never
 * reach ONE and the atomic would hang. Completion is the exact `elapsed >= duration`; `progress`
 * (0..ONE) is a derived display value for render interpolation, never the completion test.
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
   * Present (true) only while the atomic is running its inter-swing rest tail: the harvest effect already
   * applied and its completion event already fired, and the executor extended `duration` so the gatherer
   * stands its breather in the swing's ready pose (the effect stays the harvest so the tail chains straight
   * into the next swing). The tail completes silently — no `atomicCompleted` re-emit. Absent on every other
   * atomic.
   */
  restTail?: boolean;
}>('CurrentAtomic');

/** A settler carrying goods (carriers physically haul; goods never teleport to a global bank). */
export const Carrying = defineComponent<{ goodType: number; amount: number }>('Carrying');

/**
 * A builder's CONSTRUCTION-SITE crew membership: the site this settler is raising. Stamped by the
 * builder drive whenever it engages a site (hammer / fetch / wait), so membership survives waiting for
 * material, a player detour, or a meal — the workers window lists the crew stably instead of flickering
 * with each atomic. `pinned` marks a player-made assignment (the `assignBuilder` right-click, faithful
 * to the original's "put a builder on a foundation"): a pinned site wins over the nearest-site pick
 * while it still stands. Cleared when the settler stops being a builder, no site remains, or the
 * pinned site finishes (the drive re-stamps or removes it). Entity id + boolean — hashes like any
 * other component.
 */
export const SiteAssignment = defineComponent<{ site: Entity; pinned: boolean }>('SiteAssignment');

/**
 * A settler's live construction-supply errand: it is fetching (or hauling) `amount` of `goodType`
 * toward `site`. Stamped when the builder drive commits a fetch or the delivery drive routes a load to
 * a site, cleared at the top of the settler's own next planning (the rungs re-stamp it while the errand
 * lasts) — so it persists through the walk/pickup/haul and dies with the errand. Later-planned settlers
 * subtract these from a site's outstanding need ({@link
 * import('../systems/stores/construction.js').inboundSupply}), so two builders don't race to fetch the
 * same last unit and a crew spreads over different materials. Entity id + integers — hashes like any
 * other component.
 */
export const SupplyRun = defineComponent<{ site: Entity; goodType: number; amount: number }>('SupplyRun');

/**
 * A worker→workplace binding: the specific {@link Building} a settler is employed at. The JobSystem assigns
 * it when it gives an idle settler a job (it picks a concrete understaffed building, not just a job type),
 * and the AI planner uses it as the source of truth for "which mill is mine": the walk-to-workplace drive
 * heads for this building and the staffs-here pin latches the settler only on it. Without it, two same-type
 * workplaces shared one tribe-wide head-count stand-in (so they couldn't staff independently) and the pin
 * keyed on merely standing on any workplace of the job (so a worker that stepped off could be re-lured to a
 * different mill).
 *
 * A separate optional component (not a `Settler` field) so an unemployed settler simply has none; it appears
 * the instant the JobSystem employs the settler. `workplace` is an {@link Entity} id. A settler already
 * standing on a workplace it staffs but lacking a binding (e.g. spawned pre-employed) is adopted by the
 * JobSystem — bound to the building under its feet — so the binding stays the authority without a behavior change.
 */
export const JobAssignment = defineComponent<{ workplace: Entity }>('JobAssignment');

/**
 * A settler's age while it is still a non-working life stage (baby/child) — the integer count of ticks
 * lived. Like {@link JobAssignment}, a separate optional component: only a settler born young (the
 * ReproductionSystem) carries it, and the GrowthSystem ({@link growthSystem}) increments it each tick and
 * promotes the settler's age-class `jobType` (baby → child → adult-eligible) as it crosses each stage
 * boundary. The component is removed the moment the settler reaches adult-eligibility (`jobType` cleared to
 * `null`) — a grown settler is just an idle adult the JobSystem can employ. So an adult never carries an
 * `Age`; every settler spawned by `spawnSettler` (born adult) has none.
 *
 * `ticks` is a monotonic integer (age is a whole-tick count, not a 0..ONE bar).
 */
export const Age = defineComponent<{ ticks: number }>('Age');

/**
 * A **player move order** in flight on a settler — the EN-ROUTE marker the RTS "go there" command
 * stamps ({@link import('../systems/orders/index.js').moveUnit}). While present, the AISystem's ECONOMY
 * branch and the combat auto-drives leave the unit alone (the reposition is authoritative), but its
 * NEEDS drives still fire. The {@link import('../systems/orders/index.js').playerOrderSystem} removes
 * it the tick the unit arrives (or the route fails / a need takes over) — no post-arrival hold: a unit
 * sent somewhere resumes autonomy the moment it gets there (the timed stand was cut on user feedback
 * 2026-07-14; DEFEND's stance anchor is the "hold position" tool). A separate optional marker
 * component (the JobAssignment/Age pattern).
 */
export const PlayerOrder = defineComponent<Record<string, never>>('PlayerOrder');
