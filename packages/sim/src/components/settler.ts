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
   * 0..ONE fatigue/tiredness; rises over time like {@link hunger}, the second need the NeedsSystem
   * tracks. The original satisfies it with the `sleep` atomic (id 8, bound for every job/tribe in
   * `tribetypes` `setatomic <job> 8 "..._sleep"`); the rise/reset loop mirrors hunger's. The rest
   * *drive* (a settler heading off to sleep when fatigue crosses a threshold) is a later slice — this
   * field + its rise is the fatigue-rise half (the same split hunger went through).
   */
  fatigue: Fixed;
  /**
   * 0..ONE piety — the first **target-bound** non-food need (a settler must walk to a SITE to satisfy
   * it, unlike eat at a store or sleep in place). Rises over time like {@link hunger}/{@link fatigue};
   * the original satisfies it with the `pray` atomic (id 12, bound for the civilist job in
   * `tribetypes` `setatomic 6 12 "..._pray"`) run **at a temple** — the need→satisfier→building-target
   * lookup is the genuinely-new piece the *drive* introduces (a later slice). This field + its rise is
   * the piety-rise half (the same rise-then-drive split hunger and fatigue went through). The other
   * target-bound needs (`enjoy` id 17 / `make_love` id 78) follow the same shape.
   */
  piety: Fixed;
  /**
   * 0..ONE enjoyment — the recreation/leisure need. Rises over time like {@link hunger}/{@link fatigue}/
   * {@link piety}; the original satisfies it with TWO atomics that both restore **channel 3** (the
   * leisure bar): `enjoy` (id 17, `setatomic 6 17 "..._civilist_enjoy"`, `event <at> 3 +100`) and
   * `make_love` (id 78, bound for the civilist + woman jobs in `setatomic {5,6} 78 "..._make_love"`,
   * `event <at> 3 +800` — a bigger leisure boost). `make_love` is NOT a separate need: it resets this
   * same `enjoyment` field. (channel 1 = rest, 2 = hunger, 3 = leisure.) This field + its rise is the
   * enjoyment-rise half (the same rise-then-drive split hunger, fatigue and piety went through). Unlike
   * piety (satisfied at a *temple*), neither `enjoy` nor `make_love` has a **readable building
   * satisfier** to walk to — the only no-recipe/no-worker/no-stock houses in `houses.ini` are the temple
   * and a decorative wall, neither a leisure site — so the DRIVE (where it is satisfied) is deferred
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
   * Present (true) only while the atomic is running its INTER-SWING REST TAIL: the harvest effect
   * already applied and its completion event already fired, and the executor extended `duration` so
   * the gatherer stands its breather in the swing's ready pose (no pose snap, no second animation —
   * the effect stays the harvest so the tail can chain straight into the next swing when it ends).
   * The tail itself completes silently — no `atomicCompleted` re-emit for the same swing. Absent on
   * every other atomic (the separate-optional-field pattern keeps old hashes).
   */
  restTail?: boolean;
}>('CurrentAtomic');

/** A settler carrying goods (carriers physically haul; goods never teleport to a global bank). */
export const Carrying = defineComponent<{ goodType: number; amount: number }>('Carrying');

/**
 * A worker→workplace binding: the specific {@link Building} a settler is employed at. The JobSystem
 * assigns it when it gives an idle settler a job (it picks a concrete understaffed building, not just
 * a job *type*), and the AI planner uses it as the single source of truth for "which mill is mine":
 * the walk-to-workplace drive heads for *this* building and the staffs-here pin latches the settler
 * only on it. Without it, two same-type workplaces shared one tribe-wide head-count stand-in (so they
 * couldn't staff independently) and the pin keyed on merely *standing on any* workplace of the job
 * (so a worker that briefly stepped off could be re-lured to a different mill).
 *
 * The binding is a separate optional component (not a `Settler` field) so an idle/unemployed settler
 * simply has none — it appears the instant the JobSystem employs the settler and is the assignment's
 * record. `workplace` is an {@link Entity} id (a monotonic integer), so it hashes deterministically
 * like every other component. A settler already standing on a workplace it staffs but lacking a
 * binding (e.g. one spawned pre-employed onto its station) is *adopted* by the JobSystem — bound to
 * the building under its feet — so the binding stays the authority without a behavior change.
 */
export const JobAssignment = defineComponent<{ workplace: Entity }>('JobAssignment');

/**
 * A settler's **age** while it is still a non-working life stage (baby/child) — the integer count of
 * ticks lived. Like {@link JobAssignment}, it is a **separate optional component**, not a `Settler`
 * field: only a settler born young (the ReproductionSystem) carries it, and the GrowthSystem
 * ({@link growthSystem}) increments it each tick and **promotes** the settler's age-class `jobType`
 * (baby → child → adult-eligible) as it crosses each stage boundary. The component is **removed** the
 * moment the settler reaches adult-eligibility (`jobType` cleared to `null`) — a grown settler is just
 * an idle adult the JobSystem can employ, with no age bookkeeping. So an adult never carries an `Age`:
 * the goldens/slice and every settler spawned by `spawnSettler` (born already adult) have none, leaving
 * the hash untouched, exactly the [JobAssignment] separate-optional-component pattern.
 *
 * `ticks` is a monotonic integer (no fixed-point — age is a whole-tick count, not a 0..ONE bar), so it
 * hashes deterministically like every other component. Determinism: the GrowthSystem advances it with
 * a fixed per-tick increment and a fixed stage cadence, no RNG/wall-clock.
 */
export const Age = defineComponent<{ ticks: number }>('Age');

/**
 * A **player move order** in flight on a settler — the soft, TIMED override the RTS "go there" command
 * stamps ({@link import('../systems/orders/index.js').moveUnit}). It is what makes a manual move
 * faithful to *Cultures*: the unit walks to the ordered spot, STANDS there a while, then the economy AI
 * reclaims it — the order never seizes the unit permanently.
 *
 * `holdTicks` is how long to stand after arriving (short for a worker, long for a soldier — set from
 * the unit's combatant-ness at order time). `expiresAt` is the tick the hold ends, **null until the
 * unit arrives** and the hold begins — the {@link import('../systems/orders/index.js').playerOrderSystem}
 * sets it on arrival and removes the component on expiry (or when a need drive takes the unit over).
 * While present, the AISystem's ECONOMY branch skips the unit (it stays put) but its NEEDS drives still
 * fire, so hunger/fatigue can pull it away mid-hold.
 *
 * A **separate optional component** (the JobAssignment/Age pattern): only a unit under an active order
 * carries one; every existing spawn / the golden path has none, so it leaves the golden hash untouched.
 * `holdTicks`/`expiresAt` are plain integers (or null), so it hashes deterministically. Determinism:
 * set from the command + tick counter, no RNG / wall-clock.
 */
export const PlayerOrder = defineComponent<{ holdTicks: number; expiresAt: number | null }>('PlayerOrder');
