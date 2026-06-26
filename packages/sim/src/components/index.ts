import type { AtomicEffect } from '../commands.js';
import { type Entity, defineComponent } from '../ecs/world.js';
import type { Fixed } from '../fixed.js';

/**
 * Components are PLAIN DATA only. Positions/velocities are fixed-point (see fixed.ts) — never floats.
 * This set covers the Phase-2 vertical slice and the atomic-action model; grow it as systems land.
 */

/** World position in fixed-point tile units. */
export const Position = defineComponent<{ x: Fixed; y: Fixed }>('Position');

/** Per-tick movement delta in fixed-point tile units. */
export const Velocity = defineComponent<{ x: Fixed; y: Fixed }>('Velocity');

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
   * pending a content building→need binding; only the rise + the two resets are pinned (docs/FIDELITY.md).
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
}>('CurrentAtomic');

/** A building instance placed in the world. */
export const Building = defineComponent<{
  buildingType: number;
  tribe: number;
  built: Fixed; // 0..ONE construction progress
  level: number; // houses level up (home level 00..04 -> population capacity)
}>('Building');

/**
 * A goods store attached to a building: goodType -> amount, with per-good capacity from the
 * building type. DETERMINISM: never iterate this Map directly for game decisions — use
 * stockpileEntries() which returns ascending-goodType order. Raw Map iteration is insertion-order
 * (history-dependent) and is a determinism footgun (see CLAUDE.md anti-patterns).
 */
export const Stockpile = defineComponent<{ amounts: Map<number, number> }>('Stockpile');

/** Canonical (ascending goodType) view of a stockpile. Always use this for game logic. */
export function stockpileEntries(s: { amounts: Map<number, number> }): Array<[number, number]> {
  return [...s.amounts.entries()].sort((a, b) => a[0] - b[0]);
}

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
 * A combatant's **hitpoints** — the life pool the hit-resolution loop drains. A settler/animal with
 * a `Health` can be attacked: a completed `attack` atomic subtracts its resolved net damage from
 * `hitpoints` (clamped at 0 — a hit never heals; see the AtomicSystem's `attack` effect), and a
 * pool that reaches 0 is "dead" (the death/cleanup loop is a later slice — for now a 0-HP entity
 * just stops being a viable target).
 *
 * `hitpoints`/`max` are **whole integers**, not fixed-point 0..ONE bars: hitpoints are a large
 * integer scale in the original (`animaltypes.ini` `hitpoints_adult` runs 200..20000, e.g. wolf
 * 1000, bear 7000, mammoth 20000) and net damage is the integer `combatDamage` join (the per-class
 * `weapontypes` damage minus the armor `blockingValue`), so the whole pool stays integer arithmetic —
 * no truncation, exact `hitpoints <= 0` death test. It is a **separate optional component** (like
 * {@link JobAssignment}/{@link Age}): only a combatant carries one, so a non-combat settler/the
 * golden slice has none and the hash is untouched. Determinism: drained by a fixed integer
 * subtraction, no RNG/wall-clock.
 */
export const Health = defineComponent<{ hitpoints: number; max: number }>('Health');

/**
 * A herd membership: the {@link Entity} that leads the pack this animal belongs to. The animal-spawn
 * mechanic (the `spawnAnimalHerd` command) adds it to every member of a herd whose `animaltypes.ini`
 * record sets `searchforleader` — a leader is designated (the herd's lowest-id member, which points
 * `leader` at **itself**) and each follower points `leader` at it. A **solitary** animal (a record
 * with `searchforleader` false) carries **no** `HerdMember` at all: it has no leader to follow.
 *
 * This is the data foundation the later **follow-the-leader** movement drive consumes (a follower
 * stays within `maximumLeaderDistance` of its leader); this slice only *records* the relation, it adds
 * no movement behaviour yet (no oracle for the herd-cohesion AI — see docs/FIDELITY.md). Like
 * {@link JobAssignment}/{@link Age}/{@link Health} it is a **separate optional component**: only a
 * herding animal carries one, so a civilization settler / the golden slice has none and the hash is
 * untouched. `leader` is an {@link Entity} id (a monotonic integer), so it hashes deterministically
 * like every other component. A leader carrying a self-referential `HerdMember` is intentional — it
 * marks "this is a herd leader" without a second flag component, and a follower can read its leader's
 * membership uniformly. Determinism: set once at spawn from a canonical (lowest-id) leader pick, no
 * RNG/wall-clock.
 */
export const HerdMember = defineComponent<{ leader: Entity }>('HerdMember');

/**
 * A harvestable resource node placed in the world (a tree, ore vein, berry bush). It yields its
 * `goodType` when a settler runs the good's harvest atomic on its cell; `remaining` is the units
 * left — each completed harvest decrements it (AtomicSystem's harvest effect), so a finite node
 * empties and the planner's `remaining <= 0` gate then skips it. `harvestAtomic` is the
 * numeric atomic id to run (the good's `atomicForHarvesting`), kept so the planner stays data-driven
 * — it picks the atomic from content, never hardcodes one. A node sits on the cell under its
 * {@link Position} (snapped to a cell by `cellAtClamped`).
 */
export const Resource = defineComponent<{
  goodType: number;
  remaining: number;
  harvestAtomic: number;
}>('Resource');

/**
 * An in-progress production cycle on a workplace (a {@link Building} whose building type carries a
 * `recipe`). The ProductionSystem consumes the recipe's input goods from the building's own
 * {@link Stockpile} when a cycle starts, advances the integer `elapsed` tick counter, and on the
 * `recipe.ticks`-th tick deposits the output goods (capped at the building type's per-good capacity,
 * with room reserved at start so they always fit). The component exists only while a cycle is
 * running — its absence means the workplace is idle/ready to start the next cycle.
 *
 * Timing is the exact integer compare `elapsed >= duration` (like {@link CurrentAtomic}) — never an
 * accumulated fixed-point step, which would truncate and hang. `duration` mirrors the recipe's
 * `ticks` (snapshotted so a content edit mid-cycle can't change an in-flight cycle's length).
 */
export const Production = defineComponent<{
  /** Whole ticks elapsed in the current cycle; completion is the exact `elapsed >= duration`. */
  elapsed: number;
  /** Ticks one cycle takes (the recipe's `ticks`, snapshotted at cycle start; >= 1). */
  duration: number;
}>('Production');

/** A path the entity is following: fixed-point waypoints + current index. */
export const PathFollow = defineComponent<{ waypoints: Array<{ x: Fixed; y: Fixed }>; index: number }>(
  'PathFollow',
);

/**
 * A navigation goal: the destination cell an entity wants to reach (a raw row-major cell id, like
 * {@link PathRequest}). It is the *intent* layer above pathing — the AISystem (navigation planner)
 * turns a goal on a path-less, request-less entity into a {@link PathRequest} from the entity's
 * current cell; PathfindingSystem turns that into a {@link PathFollow}; MovementSystem walks it.
 * The goal is removed once the entity arrives, so an entity carrying a `MoveGoal` is "still
 * travelling". Kept separate from PathRequest/PathFollow (the transient mechanism) so the planner
 * can re-issue a request if a route is lost without forgetting where the entity was headed.
 */
export const MoveGoal = defineComponent<{ cell: number }>('MoveGoal');

/**
 * A pending navigation request: route this entity from cell `start` to cell `goal`. The
 * PathfindingSystem drains these (budgeted per tick), runs A* on `ctx.terrain`, and on success
 * replaces the entity's {@link PathFollow} with the result then removes the request; on failure
 * (no route / unwalkable endpoint / no terrain) it sets `failed` so the planner can react and
 * stops retrying the same dead query every tick. `start`/`goal` are raw row-major cell ids
 * (`y*width + x`) — plain numbers here so this component stays serializable like every other.
 */
export const PathRequest = defineComponent<{ start: number; goal: number; failed: boolean }>('PathRequest');
