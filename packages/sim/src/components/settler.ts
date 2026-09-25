import type { AtomicEffect } from '../core/atomic-effect.js';
import type { Command } from '../core/commands/index.js';
import { type Fixed, fx } from '../core/fixed.js';
import { type DeepReadonly, defineComponent, type Entity, type World } from '../ecs/world.js';
import type { NodeId } from '../nav/terrain/index.js';

/** The `(tribe, job)` pair that keys a settler's content lookups. */
export interface SettlerIdentity {
  readonly tribe: number;
  readonly jobType: number | null;
}

/** An autonomous individual; `jobType` constrains which atomics it may run (`jobtypes.allowatomic`). */
export const Settler = defineComponent<{
  readonly tribe: number;
  /** Written only through {@link setSettlerJob}. */
  readonly jobType: number | null;
  /** 0..ONE; rises over time. */
  hunger: Fixed;
  /** 0..ONE; rises over time, cleared by the `sleep` atomic (id 8, `tribetypes` `setatomic <job> 8`). */
  fatigue: Fixed;
  /**
   * 0..ONE; does not rise with time - only forging a weapon or armor good raises it. The `pray` atomic
   * (id 12, `setatomic 6 12`) at a lit home, a temple or the headquarters lowers it, and so does a nearby
   * temple's blessing.
   */
  piety: Fixed;
  /**
   * 0..ONE; rises over time and is restored only by the talk/monologuize/listen atomics (14/13/15), never
   * by a building (the original's channel 3, leisure/social).
   */
  enjoyment: Fixed;
}>('Settler', 'settlers');

export type SettlerState = NonNullable<(typeof Settler)['__value']>;

/** The read-only {@link Settler} view `World.get` hands a planner or drive. */
export type SettlerView = DeepReadonly<SettlerState>;

/**
 * What a settler has learned, carried by every {@link Settler}. Kept apart from the needs the drain
 * rewrites every tick, so those writes do not re-fold the experience map into the sync digest.
 */
export const SettlerProgress = defineComponent<{
  /** specialization id -> experience points (humanjobexperiencetypes). */
  experience: Map<number, number>;
  /** The trades and goods a school or a retraining added beyond the current trade. */
  learned?: { job: number[]; good: number[] };
}>('SettlerProgress', 'settlers');

export type SettlerProgressState = NonNullable<(typeof SettlerProgress)['__value']>;

export type SettlerProgressView = DeepReadonly<SettlerProgressState>;

/** Marks a settler as a person rather than the wildlife that shares the {@link Settler} model. Never
 *  removed, so `query(Person, …)` is a human-only system's filter. */
export const Person = defineComponent<{ readonly person: true }>('Person', 'settlers');

/** Add a person: a {@link Settler} carrying the {@link Person} marker. The only path that mints one. */
export function addPerson(
  world: World,
  entity: Entity,
  state: SettlerState,
  progress: SettlerProgressState = { experience: new Map() },
): void {
  world.add(entity, Settler, state);
  world.add(entity, SettlerProgress, progress);
  world.add(entity, Person, { person: true });
}

/** Add a creature of an animal `tribe`: a {@link Settler} with no {@link Person} and no trade. */
export function addWildlife(world: World, entity: Entity, tribe: number): void {
  world.add(entity, Settler, {
    tribe,
    jobType: null,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  world.add(entity, SettlerProgress, { experience: new Map() });
}

export function isWildlife(world: World, entity: Entity): boolean {
  return world.has(entity, Settler) && !world.has(entity, Person);
}

type SettlerTradeWrite = { jobType: number | null };

/**
 * The one write path for `Settler.jobType` (`null` = idle): the in-place write is invisible to the
 * membership generation, so it bumps the value generation the alive-jobs table is keyed on.
 */
export function setSettlerJob(world: World, entity: Entity, jobType: number | null): void {
  const s = world.mut(entity, Settler);
  (s as SettlerTradeWrite).jobType = jobType;
  noteSettlerProgress(world, entity);
  tradeLogs.get(world)?.add(entity);
}

/**
 * Per world, the settlers whose trade, experience or learned lists were written in place since the
 * technology sweep last drained the log. The needs drain writes every Settler each tick, so its change
 * channels cannot single out a trade change; the write paths report here instead. Derived
 * bookkeeping, never hashed or saved; a world whose log was never opened records nothing.
 */
const progressLogs = new WeakMap<World, Set<Entity>>();

/** Report an in-place write of `entity`'s trade, experience or learned lists. */
export function noteSettlerProgress(world: World, entity: Entity): void {
  progressLogs.get(world)?.add(entity);
}

/** `world`'s progress log, opened on first use, for the technology sweep to drain. */
export function settlerProgressLog(world: World): Set<Entity> {
  let log = progressLogs.get(world);
  if (log === undefined) {
    log = new Set();
    progressLogs.set(world, log);
  }
  return log;
}

/** Per world, the settlers whose trade {@link setSettlerJob} wrote since the workshop workforce index
 *  last drained the log: the progress log's narrower twin, for a reader that ignores experience. */
const tradeLogs = new WeakMap<World, Set<Entity>>();

/** `world`'s trade log, opened on first use, for the workshop workforce index to drain. */
export function settlerTradeLog(world: World): Set<Entity> {
  let log = tradeLogs.get(world);
  if (log === undefined) {
    log = new Set();
    tradeLogs.set(world, log);
  }
  return log;
}

/**
 * The atomic micro-action a settler is currently executing; its {@link AtomicEffect} applies on completion
 * and the component is removed, so an entity carrying none is ready for its next. Its {@link AtomicClock}
 * times it. Add and remove the two through {@link addCurrentAtomic} and {@link removeCurrentAtomic}.
 */
export const CurrentAtomic = defineComponent<{
  /** Join key onto a tribe's `setatomic` animation. */
  atomicId: number;
  duration: number; // animation length in ticks (>= 1)
  effect: AtomicEffect;
  targetEntity: number | null;
  targetTile: { x: number; y: number } | null;
}>('CurrentAtomic', 'settlers');

export type CurrentAtomicState = NonNullable<(typeof CurrentAtomic)['__value']>;

/**
 * Whole ticks the {@link CurrentAtomic} has executed; completion is the exact `elapsed >= duration`. Kept
 * apart so the per-tick count does not re-fold the atomic's effect into the sync digest.
 */
export const AtomicClock = defineComponent<{ elapsed: number }>('AtomicClock', 'settlers');

/** Start `atomic` on `settler` with its clock at `elapsed` ticks, replacing any it was running. */
export function addCurrentAtomic(
  world: World,
  settler: Entity,
  atomic: CurrentAtomicState,
  elapsed = 0,
): void {
  world.add(settler, CurrentAtomic, atomic);
  world.add(settler, AtomicClock, { elapsed });
}

/** End the atomic `settler` is running, if any, with its clock. */
export function removeCurrentAtomic(world: World, settler: Entity): void {
  world.remove(settler, CurrentAtomic);
  world.remove(settler, AtomicClock);
}

/** Goods a settler is physically hauling; goods never teleport to a global bank. */
export const Carrying = defineComponent<{ goodType: number; amount: number }>('Carrying', 'settlers');

/** The most units a settler picks up in one lift. Observation: a person carries one good unit at a time. */
export const CARRY_CAPACITY = 1;

/**
 * A builder's crew membership at a construction site or a damaged building it mends, re-stamped whenever
 * the builder drive engages the site, so it survives a wait for material, a detour, or a meal. `pinned`
 * marks the `assignBuilder` order's site, which wins over the nearest-site pick while that site still
 * stands unfinished or damaged.
 */
export const SiteAssignment = defineComponent<{ site: Entity; pinned: boolean }>(
  'SiteAssignment',
  'settlers',
);

/**
 * A settler's live construction or workshop supply errand, cleared and re-stamped at the top of its own next planning
 * pass. Settlers planned later subtract these from a site's outstanding need and, while the pickup leg is
 * live, from the chosen source's available stock. `source` is null after pickup, on the delivery leg.
 */
export const SupplyRun = defineComponent<{
  site: Entity;
  goodType: number;
  amount: number;
  source: Entity | null;
}>('SupplyRun', 'settlers');

/**
 * The specific `Building` a settler is employed at, so two same-type workplaces staff independently.
 * Only the `assignWorker` order stamps it; nothing else employs a settler.
 */
export const JobAssignment = defineComponent<{ workplace: Entity }>('JobAssignment', 'settlers');

/**
 * A settler's age in whole ticks while it is still a non-working life stage. The GrowthSystem promotes the
 * age-class `jobType` at each stage boundary and removes the component at adult-eligibility, so an adult
 * carries none.
 */
export const Age = defineComponent<{ ticks: number }>('Age', 'settlers');

/**
 * A player move order in flight on a settler: the planner's economy branch and the combat auto-drives leave
 * it alone while its needs drives still fire. Removed on arrival, on route failure, or when a need takes
 * over. `pendingGoal` parks the destination while a settler carrying a load runs its drop atomic.
 */
export const PlayerOrder = defineComponent<{
  pendingGoal?: NodeId;
  attackMove?: AttackMoveMarch;
}>('PlayerOrder', 'settlers');

/**
 * An adult whose drive ladder last found it nothing to do, so it re-plans only on its staggered due ticks
 * (`settlers/planner/idle-replan.ts`). Removed once anything moves it or a command addresses it.
 * `standing` is true when the ladder ended in its idle tail, false for a flag gatherer waiting by its flag.
 */
export const IdleStand = defineComponent<{ standing: boolean }>('IdleStand', 'settlers');

/**
 * The march an attack-move order walks out - the original's "Attack Position" (`misclogic/48`). Unlike a
 * plain move order it leaves the combat auto-drives running: the unit walks under `MILITARY_MODE.ATTACK`
 * whatever its own stance says. Approximation: the original's en-route behaviour is unobserved, and its
 * vocabulary scopes the modes to soldiers (`misclogic/38-40`), so here an ordered civilian fights too.
 *
 * `goal` outlives a fight overwriting the `MoveGoal` with chase destinations; `resume` re-issues it exactly
 * once when the unit next falls idle, since a re-aimed goal makes an arrival test unusable; `blockedUntil`
 * rests the aggression through a tick whose chase could not route.
 */
export interface AttackMoveMarch {
  readonly goal: NodeId;
  resume: boolean;
  blockedUntil: number;
}

/** The order kinds a running non-interruptible atomic parks instead of cancelling. */
export type DeferrableOrderCommand = Extract<
  Command,
  { kind: 'moveUnit' | 'attackMoveUnit' | 'setJob' | 'placeSignpost' | 'openChest' }
>;

/**
 * A gameplay order parked behind a non-interruptible atomic instead of cancelling it; `deferredOrderSystem`
 * re-dispatches it once the atomic completes. One slot per settler, latest-order-wins - an approximation,
 * since the original's queueing depth under back-to-back orders is unobserved.
 */
export const DeferredOrder = defineComponent<{ command: DeferrableOrderCommand }>(
  'DeferredOrder',
  'settlers',
);
