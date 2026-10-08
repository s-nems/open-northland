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
}>('Settler', 'settlers');

/** The bars the needs pass drains every tick: none, hunger and fatigue (a fighter's company is frozen), or
 *  all three. Piety never drains. */
export type NeedDrain = 'none' | 'body' | 'all';

/** A settler's four need bars. A tick's drain alone leaves this unwritten, so read hunger, fatigue and
 *  enjoyment through `needLevel` (`systems/lifecycle/needs`), never directly. */
export const SettlerNeeds = defineComponent<{
  /** 0..ONE as of {@link asOf}; rises over time. */
  hunger: Fixed;
  /** 0..ONE as of {@link asOf}; rises over time, cleared by the `sleep` atomic (id 8, `tribetypes`
   *  `setatomic <job> 8`). */
  fatigue: Fixed;
  /**
   * 0..ONE; does not rise with time, so it is stored as it stands - only forging a weapon or armor good
   * raises it. The `pray` atomic (id 12, `setatomic 6 12`) at a lit home, a temple or the headquarters
   * lowers it, and so does a nearby temple's blessing.
   */
  piety: Fixed;
  /**
   * 0..ONE as of {@link asOf}; rises over time and is restored by social atomics
   * (talk, monologuize, listen and celebration), never by a building (the original's channel 3, leisure/social).
   */
  enjoyment: Fixed;
  /** The tick whose drain pass the stored hunger, fatigue and enjoyment include. */
  asOf: number;
  /** The bars each later drain pass raises; set only by the needs pass. */
  drain: NeedDrain;
}>('SettlerNeeds', 'settlers');

export type SettlerNeedsState = NonNullable<(typeof SettlerNeeds)['__value']>;
export type SettlerNeedsView = DeepReadonly<SettlerNeedsState>;
/** The four bars at one tick. */
export type NeedLevels = Pick<SettlerNeedsState, 'hunger' | 'fatigue' | 'piety' | 'enjoyment'>;
export type SettlerInitialState = SettlerIdentity & NeedLevels;

export type SettlerState = NonNullable<(typeof Settler)['__value']>;

/** The read-only {@link Settler} view `World.get` hands a planner or drive. */
export type SettlerView = DeepReadonly<SettlerState>;

/**
 * What a settler has learned, carried by every {@link Settler}; bar writes leave its experience map
 * untouched in the sync digest.
 */
export const SettlerProgress = defineComponent<{
  /** specialization id -> experience points (humanjobexperiencetypes). */
  experience: Map<number, number>;
  /** The trades and goods a school or a retraining added beyond the current trade. */
  learned?: { job: number[]; good: number[] };
}>('SettlerProgress', 'settlers');

export type SettlerProgressState = NonNullable<(typeof SettlerProgress)['__value']>;

export type SettlerProgressView = DeepReadonly<SettlerProgressState>;

/** The longest name, in code points, the player may give a settler. */
export const SETTLER_NAME_MAX_CHARS = 24;

/** The immutable identity dealt at birth or spawn, independent of family and occupation. */
export const NameIdentity = defineComponent<{ readonly pool: string; readonly name: string }>(
  'NameIdentity',
  'settlers',
);

/**
 * The name the player gave a settler with the `renameSettler` command: trimmed, 1..
 * {@link SETTLER_NAME_MAX_CHARS} code points, no control characters. It wins over the generated name and
 * loses to a map's `ScriptedName`.
 */
export const GivenName = defineComponent<{ name: string }>('GivenName', 'settlers');

/** Marks a settler as a person rather than the wildlife that shares the {@link Settler} model. Never
 *  removed, so `query(Person, …)` is a human-only system's filter. */
export const Person = defineComponent<{ readonly person: true }>('Person', 'settlers');

/** Mint separate identity and need payloads so a bar write leaves the identity revision unchanged. */
export function addSettler(world: World, entity: Entity, state: SettlerInitialState): void {
  world.add(entity, Settler, { tribe: state.tribe, jobType: state.jobType });
  world.add(entity, SettlerNeeds, {
    hunger: state.hunger,
    fatigue: state.fatigue,
    piety: state.piety,
    enjoyment: state.enjoyment,
    asOf: 0,
    drain: 'none',
  });
}

/** Add a person: a {@link Settler} carrying the {@link Person} marker. The only path that mints one. */
export function addPerson(
  world: World,
  entity: Entity,
  state: SettlerInitialState,
  progress: SettlerProgressState = { experience: new Map() },
): void {
  addSettler(world, entity, state);
  world.add(entity, SettlerProgress, progress);
  world.add(entity, Person, { person: true });
}

/** Add a creature of an animal `tribe`: a {@link Settler} with no {@link Person} and no trade. */
export function addWildlife(world: World, entity: Entity, tribe: number): void {
  addSettler(world, entity, {
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
  for (const log of tradeLogs.get(world)?.values() ?? []) log.add(entity);
}

/**
 * Per world, the settlers whose trade, experience or learned lists were written in place since the
 * technology sweep last drained the log. The write paths report trade and progress changes together,
 * independently of their component channels. Derived bookkeeping, never hashed or saved; a world
 * whose log was never opened records nothing.
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

/** The indexes that drain a trade log, each its own. */
export type SettlerTradeReader =
  | 'workshopWorkforce'
  | 'ownedFighters'
  | 'combatReady'
  | 'gossipCandidates'
  | 'tribeUnlocks'
  | 'livestockScouts'
  | 'standingPosts';

/** Per world and reader, the settlers whose trade {@link setSettlerJob} wrote since that reader last
 *  drained its log: the progress log's narrower twin, for a reader that ignores experience. */
const tradeLogs = new WeakMap<World, Map<SettlerTradeReader, Set<Entity>>>();

/** `reader`'s trade log in `world`, opened on first use; it records only from then on. */
export function settlerTradeLog(world: World, reader: SettlerTradeReader): Set<Entity> {
  let logs = tradeLogs.get(world);
  if (logs === undefined) {
    logs = new Map();
    tradeLogs.set(world, logs);
  }
  let log = logs.get(reader);
  if (log === undefined) {
    log = new Set();
    logs.set(reader, log);
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

/** The executor stamps the first advancing tick. Pending clocks can be created before or after that
 * tick's executor without coupling callers to the system schedule. */
export type AtomicClockState = { startedAt: number } | { pendingElapsed: number };
export const AtomicClock = defineComponent<AtomicClockState>('AtomicClock', 'settlers');

/** Whole executed ticks at a settled snapshot or during the executor's current tick. */
export function atomicElapsed(clock: Readonly<AtomicClockState>, tick: number): number {
  return 'startedAt' in clock ? tick - clock.startedAt : clock.pendingElapsed;
}

/** Start `atomic` on `settler` with its clock at `elapsed` ticks, replacing any it was running. */
export function addCurrentAtomic(
  world: World,
  settler: Entity,
  atomic: CurrentAtomicState,
  elapsed = 0,
): void {
  world.add(settler, CurrentAtomic, atomic);
  world.add(settler, AtomicClock, { pendingElapsed: elapsed });
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
 * A builder the player put on a road site or a wall segment by hand: it builds its owner's sites of that
 * kind one after another, ahead of repairs and every other site, until none is left for it to claim.
 * Any other order to the builder ends it. Owner ruling.
 */
export const BuildMode = defineComponent<{ kind: 'roads' | 'walls' }>('BuildMode', 'settlers');

/**
 * A settler's live construction or workshop supply errand, cleared and re-stamped at the top of its own
 * next planning pass. Settlers planned later subtract these from a site's outstanding need. The pickup
 * leg carries a {@link PickupClaim} beside it; the delivery leg carries this alone.
 */
export const SupplyRun = defineComponent<{
  site: Entity;
  goodType: number;
  amount: number;
}>('SupplyRun', 'settlers');

/**
 * A settler's walk to take `amount` of `goodType` out of `source`, a store or a loose pile. Settlers
 * choosing a source later subtract live claims from each candidate's stock, so a unit one settler is
 * already walking to is not offered to the next; the pickup itself is never refused on a claim. The
 * claim ends with the pickup effect, with the settler's next planning pass, or with any order that
 * diverts it, so a settler that gives the walk up frees the unit at once.
 */
export const PickupClaim = defineComponent<{
  source: Entity;
  goodType: number;
  amount: number;
}>('PickupClaim', 'settlers');

/**
 * The specific `Building` a settler is employed at, so two same-type workplaces staff independently.
 * Only the `assignWorker` order stamps it; nothing else employs a settler.
 */
export const JobAssignment = defineComponent<{ workplace: Entity }>('JobAssignment', 'settlers');

/**
 * A settler's age in whole ticks while it is still a non-working life stage: `ticks` as of the growth pass
 * of tick `asOf`, null until a growth pass first counts it. Every later pass adds one without a write, so
 * read the age through `ageTicksAt`. The GrowthSystem promotes the age-class `jobType` at each stage
 * boundary and removes the component at adult-eligibility, so an adult carries none.
 */
export const Age = defineComponent<{ ticks: number; asOf: number | null }>('Age', 'settlers');

/**
 * A player move order in flight on a settler: the planner's economy branch and the combat auto-drives leave
 * it alone while its needs drives still fire. Removed on arrival, on route failure, or when a need takes
 * over. `pendingGoal` parks the destination while a settler carrying a load runs its drop atomic.
 */
export const PlayerOrder = defineComponent<{
  pendingGoal?: NodeId;
  attackMove?: AttackMoveMarch;
  /** A map script's walk, which hunger never breaks: the script may be waiting for the arrival. */
  scripted?: true | undefined;
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

/** The order kinds a Shift-click may line up behind a settler's current order; each carries `queued`. */
export const QUEUEABLE_ORDER_KINDS = [
  'moveUnit',
  'attackMoveUnit',
  'placeSignpost',
  'openChest',
  'claimAnimal',
] as const;

export type QueueableOrderCommand = Extract<Command, { kind: (typeof QUEUEABLE_ORDER_KINDS)[number] }>;

/** How many orders may wait behind a settler's current one; a queued order past it is dropped. */
export const ORDER_QUEUE_LIMIT = 16;

/**
 * The orders a settler carries out one after another once its current order is done, oldest first;
 * `orderQueueSystem` starts the next. Any order that takes the settler without queueing drops them
 * (`dropOrderQueue`). Named addition: the original has no order queue.
 */
export const OrderQueue = defineComponent<{ orders: QueueableOrderCommand[] }>('OrderQueue', 'settlers');

/**
 * Hunger took this settler off its player orders: the needs drive feeds it while its {@link OrderQueue},
 * headed by the interrupted order, waits. Named addition: the original checks no need while a player's
 * command runs.
 */
export const MealBreak = defineComponent<{ readonly hungry: true }>('MealBreak', 'settlers');

/** A meal break that found nothing to eat: hunger takes the settler off its orders again from `retryAt`. */
export const MealBreakRetry = defineComponent<{ readonly retryAt: number }>('MealBreakRetry', 'settlers');

/** The order kinds a running non-interruptible atomic parks instead of cancelling. */
export type DeferrableOrderCommand = Extract<
  Command,
  { kind: 'moveUnit' | 'attackMoveUnit' | 'setJob' | 'placeSignpost' | 'openChest' | 'claimAnimal' }
>;

/**
 * A gameplay order parked behind a non-interruptible atomic instead of cancelling it; `deferredOrderSystem`
 * re-dispatches it once the atomic completes. One slot per settler, latest-order-wins - an approximation,
 * since the original's queueing depth under back-to-back orders is unobserved.
 */
export const DeferredOrder = defineComponent<{
  command: DeferrableOrderCommand;
  /** A map script's walk, replayed unconfined and as the script's own (`PlayerOrder.scripted`). */
  scripted?: true | undefined;
}>('DeferredOrder', 'settlers');
