import {
  Building,
  Carrying,
  Chat,
  JobAssignment,
  PathRequest,
  PickupClaim,
  Position,
  Settler,
  Stockpile,
  SupplyRun,
  settlerTradeLog,
  UnderConstruction,
  Upgrading,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { insertSortedById, removeSortedById } from '../../core/sorted-id.js';
import { ChangeFeed } from '../../ecs/change-feed.js';
import type { Component, Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { ACTION_OWNER_MARKERS, anotherSystemOwns } from '../settlers/action-owner.js';
import { boundWorkplaceTarget } from '../settlers/targets/workplaces.js';
import { assignedWorkers } from './assigned-workers.js';
import { bankedSlot, stockCapacity } from './capacity.js';
import { accessibleStockAmounts } from './inventory.js';
import { isWorkplaceOperator } from './operators.js';
import { mergedRecipeOf, recipeConsumes, refillingGoodsOf } from './workplace.js';

/** A recipe input an employed settler brings its workplace: carried (`source` null) or fetched. */
interface BoundLoad {
  readonly goodType: number;
  readonly amount: number;
  readonly source: Entity | null;
  /** {@link sourceHolds}, re-taken whenever a store it reads changes on the source. */
  holds: boolean;
}

/** What one employed settler adds to its workplace, before the stock checks a snapshot applies. */
interface Binding {
  readonly workplace: Entity;
  readonly operator: boolean;
  readonly load: BoundLoad | null;
}

/**
 * The employed settlers' bindings, kept across ticks. A settler is re-derived when a journal names it or
 * its workplace, or when {@link setSettlerJob} logs its trade, so a tick pays for the settlers and
 * workplaces that changed. A settler whose tribe has no technology table is re-derived on every read,
 * since its workplace's staffing gate reads live unlock state.
 */
interface WorkforceIndex {
  /** The latest caller's context, which the verifier re-derives with; another content set rebuilds. */
  ctx: SystemContext;
  readonly generations: Map<Component<unknown>, number>;
  readonly valueGenerations: Map<Component<unknown>, number>;
  readonly bindings: Map<Entity, Binding>;
  /** Operators per workplace, ascending id. */
  readonly crews: Map<Entity, Entity[]>;
  readonly loadsAt: Map<Entity, WorkplaceLoads>;
  /** The fetched loads by pickup source, unordered, so a changed source re-takes its loads alone. */
  readonly loadsFrom: Map<Entity, BoundLoad[]>;
  readonly untracked: Set<Entity>;
  /** Bumped by every catch-up that re-derives a settler, so a snapshot can tell its crews went stale. */
  epoch: number;
  /** Bumped by every snapshot; only the latest one reads the load stamps. */
  snapshots: number;
  /** The catch-up's dirty settlers, each once in the order first marked, reused across calls. A feed
   *  rather than a set: a long-lived set allocates a fresh table on every clear, in the old generation. */
  readonly dirty: ChangeFeed;
  /** Journal visitors marking a settler, or a workplace's bound workers, dirty; built once per index so
   *  a catch-up allocates no collected deltas, iterators or closures. */
  readonly markSettler: (e: Entity) => void;
  readonly markCrew: (workplace: Entity) => void;
  readonly resyncDirty: (e: Entity) => void;
  readonly retakeSource: (source: Entity) => void;
}

/** The loads bound for one workplace in parallel columns, unordered: an inbound read sums them. */
interface WorkplaceLoads {
  readonly settlers: Entity[];
  readonly loads: BoundLoad[];
  /** Per load, the snapshot serial it last counted at, stamped by {@link WorkshopWorkforce.shelveInbound}. */
  readonly counted: number[];
  /** The snapshot serial the loads' shelf checks were last taken at. */
  shelved: number;
}

// Everything deriveBinding reads, by owner. The settler's own trade comes from the trade log.
const SETTLER_MEMBERSHIP: readonly Component<unknown>[] = [
  JobAssignment,
  Settler,
  ...ACTION_OWNER_MARKERS,
  Chat,
  PathRequest,
  Carrying,
  SupplyRun,
  PickupClaim,
];
const SETTLER_VALUES: readonly Component<unknown>[] = [Chat, PathRequest, Carrying, SupplyRun, PickupClaim];
const WORKPLACE_MEMBERSHIP: readonly Component<unknown>[] = [Building, UnderConstruction, Position];
const WORKPLACE_VALUES: readonly Component<unknown>[] = [Building];
// Everything sourceHolds reads on a pickup source.
const SOURCE_MEMBERSHIP: readonly Component<unknown>[] = [Stockpile, Upgrading, UnderConstruction, Building];
const SOURCE_VALUES: readonly Component<unknown>[] = [Stockpile, Upgrading, Building];
const MEMBERSHIP_JOURNALS = [...SETTLER_MEMBERSHIP, ...WORKPLACE_MEMBERSHIP];
const VALUE_JOURNALS = [...SETTLER_VALUES, ...WORKPLACE_VALUES];

const indexes = new WeakMap<World, WorkforceIndex>();
/** Per world, the pickup sources changed since the last snapshot re-took their loads' {@link sourceHolds}. */
const sourceFeeds = new WeakMap<World, ChangeFeed>();
const NO_CREW: readonly Entity[] = [];
const idOf = (e: Entity): number => e;

/**
 * The employed settlers' crews and inbound loads as of this call. The crews are the live index, valid
 * until the next call brings it up to date; the loads' checks are kept as {@link WorkshopWorkforce} says.
 */
export function workshopWorkforce(world: World, ctx: SystemContext): WorkshopWorkforce {
  return new WorkshopWorkforce(world, ctx, caughtUp(world, ctx));
}

/**
 * A phase-local snapshot of the employed settlers: each workshop's crew and its inbound loads. A load
 * counts while its pickup source holds the good, as of construction, which re-takes that check for the
 * loads whose source changed since the last snapshot, and while the workplace has shelf room for it,
 * checked at the workplace's first inbound read (see {@link shelveInbound}). The checks are stamped on
 * the index, so inbound reads last until the next snapshot.
 */
export class WorkshopWorkforce {
  private readonly epoch: number;
  private readonly serial: number;

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly index: WorkforceIndex,
  ) {
    this.epoch = index.epoch;
    this.serial = ++index.snapshots;
    retakeSourceChecks(world, index);
  }

  operatorsAt(workplace: Entity): readonly Entity[] {
    if (this.index.epoch !== this.epoch) throw new Error('WorkshopWorkforce read after a newer snapshot');
    return this.index.crews.get(workplace) ?? NO_CREW;
  }

  /**
   * Take the shelf checks of the loads bound for `workplace` now, unless this snapshot already has. The
   * planner pass writes no workshop's stock, and the production start loop calls this before it writes
   * the one workshop it is on, so the checks read the stock the snapshot was taken against.
   */
  shelveInbound(workplace: Entity): void {
    const { serial } = this;
    this.assertLatest();
    const column = this.index.loadsAt.get(workplace);
    if (column === undefined || column.shelved === serial) return;
    column.shelved = serial;
    const { loads, counted } = column;
    for (let i = 0; i < loads.length; i++) {
      const load = loads[i] as BoundLoad;
      counted[i] = load.holds && shelfTakes(this.world, this.ctx, workplace, load) ? serial : NOT_COUNTED;
    }
  }

  /** Units of `goodType` the indexed loads bring to `workplace`, leaving out the settlers `skip` names. */
  incomingOf(workplace: Entity, goodType: number, skip?: (settler: Entity) => boolean): number {
    const column = this.index.loadsAt.get(workplace);
    if (column === undefined) return 0;
    this.shelveInbound(workplace);
    const { settlers, loads, counted } = column;
    let units = 0;
    for (let i = 0; i < loads.length; i++) {
      const load = loads[i] as BoundLoad;
      if (load.goodType !== goodType || counted[i] !== this.serial) continue;
      if (skip?.(settlers[i] as Entity) !== true) units += load.amount;
    }
    return units;
  }

  private assertLatest(): void {
    if (this.index.epoch !== this.epoch || this.index.snapshots !== this.serial) {
      throw new Error('WorkshopWorkforce inbound read after a newer snapshot');
    }
  }
}

const ignoreEntity = (_e: Entity): void => {};

/** A {@link WorkplaceLoads.counted} stamp no snapshot serial takes. */
const NOT_COUNTED = 0;

/** Bring every load's {@link BoundLoad.holds} up to its source's live state: the loads of the sources
 *  the feed names, or every load when the feed overflowed. */
function retakeSourceChecks(world: World, index: WorkforceIndex): void {
  const feed = sourceFeedOf(world);
  if (!feed.pending) return;
  if (feed.drain(index.retakeSource)) {
    index.loadsFrom.forEach((loads) => {
      for (let i = 0; i < loads.length; i++) {
        const load = loads[i] as BoundLoad;
        load.holds = sourceHolds(world, index.ctx, load);
      }
    });
  }
}

function sourceFeedOf(world: World): ChangeFeed {
  let feed = sourceFeeds.get(world);
  if (feed === undefined) {
    feed = world.watchChanges(SOURCE_MEMBERSHIP, SOURCE_VALUES);
    sourceFeeds.set(world, feed);
  }
  return feed;
}

/** Whether a pickup leg's source still holds the good, on its arrival tick too, before the planner
 *  starts the pickup there, or refills it, since its fetcher waits there for the unit; a carried load
 *  always passes. */
function sourceHolds(world: World, ctx: SystemContext, load: BoundLoad): boolean {
  const source = load.source;
  return (
    source === null ||
    (accessibleStockAmounts(world, source)?.get(load.goodType) ?? 0) > 0 ||
    refillingGoodsOf(world, ctx, source).includes(load.goodType)
  );
}

/** Whether the workplace has shelf room for the load's good. */
function shelfTakes(world: World, ctx: SystemContext, workplace: Entity, load: BoundLoad): boolean {
  if (bankedSlot(world, ctx, workplace, load.goodType).goodType !== load.goodType) return false;
  return (
    stockCapacity(world, ctx, workplace, load.goodType) >
    (world.get(workplace, Stockpile).amounts.get(load.goodType) ?? 0)
  );
}

function deriveBinding(world: World, ctx: SystemContext, e: Entity): Binding | null {
  const settler = world.tryGet(e, Settler);
  if (settler === undefined || !world.has(e, JobAssignment)) return null;
  if (anotherSystemOwns(world, e) || world.tryGet(e, PathRequest)?.failed === true) return null;
  if (settler.jobType === null) return null;
  const workplace = boundWorkplaceTarget(world, ctx, e, settler.jobType, settler.tribe);
  if (workplace === null) return null;
  const operator = isWorkplaceOperator(world, ctx, workplace, settler.jobType);
  const carried = world.tryGet(e, Carrying);
  const run = world.tryGet(e, SupplyRun);
  const claim = world.tryGet(e, PickupClaim);
  let load: BoundLoad | null = null;
  if (carried !== undefined) {
    load = { goodType: carried.goodType, amount: carried.amount, source: null, holds: true };
  } else if (run !== undefined && run.site === workplace && claim !== undefined) {
    load = { goodType: run.goodType, amount: run.amount, source: claim.source, holds: false };
    load.holds = sourceHolds(world, ctx, load);
  }
  if (load !== null && !recipeConsumes(mergedRecipeOf(world, ctx, workplace)?.inputs, load.goodType)) {
    load = null;
  }
  return operator || load !== null ? { workplace, operator, load } : null;
}

function caughtUp(world: World, ctx: SystemContext): WorkforceIndex {
  const held = indexes.get(world);
  if (held === undefined || held.ctx.content !== ctx.content) {
    if (held === undefined) world.registerCacheVerifier('workshopWorkforce', () => verifyIndex(world));
    return rebuild(world, ctx);
  }
  held.ctx = ctx;
  const dirty = held.dirty;
  if (dirty.pending) dirty.drain(ignoreEntity);
  held.untracked.forEach(held.markSettler);
  for (let i = 0; i < SETTLER_MEMBERSHIP.length; i++) {
    const component = SETTLER_MEMBERSHIP[i] as Component<unknown>;
    if (!world.replayMembershipSince(component, held.generations.get(component) ?? 0, held.markSettler))
      return rebuild(world, ctx);
  }
  for (let i = 0; i < SETTLER_VALUES.length; i++) {
    const component = SETTLER_VALUES[i] as Component<unknown>;
    if (!world.replayValueWritesSince(component, held.valueGenerations.get(component) ?? 0, held.markSettler))
      return rebuild(world, ctx);
  }
  for (let i = 0; i < WORKPLACE_MEMBERSHIP.length; i++) {
    const component = WORKPLACE_MEMBERSHIP[i] as Component<unknown>;
    if (!world.replayMembershipSince(component, held.generations.get(component) ?? 0, held.markCrew))
      return rebuild(world, ctx);
  }
  for (let i = 0; i < WORKPLACE_VALUES.length; i++) {
    const component = WORKPLACE_VALUES[i] as Component<unknown>;
    if (!world.replayValueWritesSince(component, held.valueGenerations.get(component) ?? 0, held.markCrew))
      return rebuild(world, ctx);
  }
  const trades = settlerTradeLog(world, 'workshopWorkforce');
  if (trades.size > 0) {
    trades.forEach(held.markSettler);
    trades.clear();
  }
  noteGenerations(world, held);
  if (!dirty.pending) return held;
  // More dirty settlers than a feed holds: it dropped them, so every binding is derived afresh.
  if (dirty.drain(held.resyncDirty)) return rebuild(world, ctx);
  held.epoch++;
  return held;
}

function rebuild(world: World, ctx: SystemContext): WorkforceIndex {
  for (const component of MEMBERSHIP_JOURNALS) world.journalMembership(component);
  for (const component of VALUE_JOURNALS) world.journalValueWrites(component);
  settlerTradeLog(world, 'workshopWorkforce').clear();
  // Derived below from live state, so the changes it names so far are already taken.
  sourceFeedOf(world).drain(ignoreEntity);
  const index = deriveIndex(world, ctx, (indexes.get(world)?.epoch ?? 0) + 1);
  indexes.set(world, index);
  return index;
}

function deriveIndex(world: World, ctx: SystemContext, epoch: number): WorkforceIndex {
  const dirty = new ChangeFeed();
  const index: WorkforceIndex = {
    ctx,
    generations: new Map(),
    valueGenerations: new Map(),
    bindings: new Map(),
    crews: new Map(),
    loadsAt: new Map(),
    loadsFrom: new Map(),
    untracked: new Set(),
    epoch,
    snapshots: 0,
    dirty,
    markSettler: (e) => {
      dirty.record(e);
    },
    markCrew: (workplace) => {
      const workers = assignedWorkers(world, workplace);
      for (let i = 0; i < workers.length; i++) dirty.record(workers[i] as Entity);
    },
    resyncDirty: (e) => resync(world, index.ctx, index, e),
    retakeSource: (source) => {
      const loads = index.loadsFrom.get(source);
      if (loads === undefined) return;
      for (let i = 0; i < loads.length; i++) {
        const load = loads[i] as BoundLoad;
        load.holds = sourceHolds(world, index.ctx, load);
      }
    },
  };
  noteGenerations(world, index);
  for (const e of world.canonicalQuery(JobAssignment, Settler)) resync(world, ctx, index, e);
  return index;
}

function noteGenerations(world: World, index: WorkforceIndex): void {
  for (const component of MEMBERSHIP_JOURNALS) {
    index.generations.set(component, world.componentGeneration(component));
  }
  for (const component of VALUE_JOURNALS) {
    index.valueGenerations.set(component, world.componentValueGeneration(component));
  }
}

/** Replace `e`'s held binding with one derived from live state. */
function resync(world: World, ctx: SystemContext, index: WorkforceIndex, e: Entity): void {
  const held = index.bindings.get(e);
  if (held !== undefined) {
    index.bindings.delete(e);
    if (held.load !== null) dropLoader(index, held.workplace, e, held.load);
    const crew = held.operator ? index.crews.get(held.workplace) : undefined;
    if (crew !== undefined && removeSortedById(crew, e, idOf) && crew.length === 0) {
      index.crews.delete(held.workplace);
    }
  }
  const tribe = world.tryGet(e, Settler)?.tribe;
  if (
    tribe !== undefined &&
    world.has(e, JobAssignment) &&
    contentIndex(ctx.content).tribes.get(tribe)?.technology === undefined
  )
    index.untracked.add(e);
  else index.untracked.delete(e);
  const binding = deriveBinding(world, ctx, e);
  if (binding === null) return;
  index.bindings.set(e, binding);
  if (binding.load !== null) {
    const source = binding.load.source;
    if (source !== null) {
      const fetched = index.loadsFrom.get(source);
      if (fetched === undefined) index.loadsFrom.set(source, [binding.load]);
      else fetched.push(binding.load);
    }
    const column = index.loadsAt.get(binding.workplace);
    if (column === undefined) {
      index.loadsAt.set(binding.workplace, {
        settlers: [e],
        loads: [binding.load],
        counted: [NOT_COUNTED],
        shelved: NOT_COUNTED,
      });
    } else {
      column.settlers.push(e);
      column.loads.push(binding.load);
      column.counted.push(NOT_COUNTED);
    }
  }
  if (!binding.operator) return;
  const crew = index.crews.get(binding.workplace);
  if (crew === undefined) index.crews.set(binding.workplace, [e]);
  else insertSortedById(crew, e, idOf);
}

function dropLoader(index: WorkforceIndex, workplace: Entity, e: Entity, load: BoundLoad): void {
  const fetched = load.source === null ? undefined : index.loadsFrom.get(load.source);
  const from = fetched === undefined ? -1 : fetched.indexOf(load);
  if (fetched !== undefined && from >= 0) {
    if (fetched.length === 1) index.loadsFrom.delete(load.source as Entity);
    else swapRemove(fetched, from);
  }
  const column = index.loadsAt.get(workplace);
  const at = column === undefined ? -1 : column.settlers.indexOf(e);
  if (column === undefined || at < 0) return;
  if (column.settlers.length === 1) {
    index.loadsAt.delete(workplace);
    return;
  }
  swapRemove(column.settlers, at);
  swapRemove(column.loads, at);
  swapRemove(column.counted, at);
}

function swapRemove<T>(list: T[], at: number): void {
  const last = list.pop() as T;
  if (at < list.length) list[at] = last;
}

/** Brings the held index up to date, then compares it with a fresh derivation: a missed dependency
 *  shows up as a binding the journals never re-derived. Peeks the source feed, leaving the load checks
 *  to the next snapshot. */
function verifyIndex(world: World): string[] {
  const last = indexes.get(world);
  if (last === undefined) return [];
  const held = caughtUp(world, last.ctx);
  const fresh = deriveIndex(world, held.ctx, held.epoch);
  if (fresh.bindings.size !== held.bindings.size) {
    return [`workshopWorkforce holds ${held.bindings.size} bindings but re-derived ${fresh.bindings.size}`];
  }
  for (const [e, binding] of fresh.bindings) {
    if (!sameBinding(binding, held.bindings.get(e))) {
      return [`workshopWorkforce holds a stale binding for settler ${e}`];
    }
  }
  // A source pending in the feed is re-taken by the next snapshot; an overflowed feed re-takes every one.
  const pendingSources = new Set<Entity>();
  const sourcesLost = sourceFeedOf(world).peek((source) => pendingSources.add(source));
  for (const [e, binding] of held.bindings) {
    const load = binding.load;
    if (load === null || sourcesLost || (load.source !== null && pendingSources.has(load.source))) continue;
    if (load.holds !== sourceHolds(world, held.ctx, load)) {
      return [`workshopWorkforce holds a stale source check for settler ${e}`];
    }
  }
  for (const [workplace, crew] of fresh.crews) {
    const listed = held.crews.get(workplace) ?? NO_CREW;
    if (listed.length !== crew.length || listed.some((e, i) => e !== crew[i])) {
      return [`workshopWorkforce holds a stale crew at workplace ${workplace}`];
    }
  }
  return fresh.crews.size === held.crews.size
    ? []
    : ['workshopWorkforce holds a crew of a workplace nobody operates'];
}

function sameBinding(a: Binding, b: Binding | undefined): boolean {
  return (
    b !== undefined &&
    a.workplace === b.workplace &&
    a.operator === b.operator &&
    a.load?.goodType === b.load?.goodType &&
    a.load?.amount === b.load?.amount &&
    a.load?.source === b.load?.source
  );
}
