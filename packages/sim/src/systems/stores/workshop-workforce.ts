import {
  Building,
  Carrying,
  Chat,
  JobAssignment,
  PathRequest,
  Position,
  Settler,
  Stockpile,
  SupplyRun,
  settlerTradeLog,
  UnderConstruction,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { insertSortedById, removeSortedById } from '../../core/sorted-id.js';
import type { Component, Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { ACTION_OWNER_MARKERS, anotherSystemOwns } from '../settlers/action-owner.js';
import { boundWorkplaceTarget } from '../settlers/targets/workplaces.js';
import { assignedWorkers } from './assigned-workers.js';
import { bankedSlot, stockCapacity } from './capacity.js';
import { accessibleStockAmounts } from './inventory.js';
import { isWorkplaceOperator } from './operators.js';
import { mergedRecipeOf, recipeConsumes } from './workplace.js';

/** One settler's unit on its way to a workplace: carried, or on a pickup leg whose source still has it. */
export interface SupplyLoad {
  readonly settler: Entity;
  readonly goodType: number;
  readonly amount: number;
}

/** A recipe input an employed settler brings its workplace: carried (`source` null) or fetched. */
interface BoundLoad {
  readonly goodType: number;
  readonly amount: number;
  readonly source: Entity | null;
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
  readonly loaders: Set<Entity>;
  readonly untracked: Set<Entity>;
  /** Bumped by every catch-up that re-derives a settler, so a snapshot can tell its crews went stale. */
  epoch: number;
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
];
const SETTLER_VALUES: readonly Component<unknown>[] = [Chat, PathRequest, Carrying, SupplyRun];
const WORKPLACE_MEMBERSHIP: readonly Component<unknown>[] = [Building, UnderConstruction, Position];
const WORKPLACE_VALUES: readonly Component<unknown>[] = [Building];
const MEMBERSHIP_JOURNALS = [...SETTLER_MEMBERSHIP, ...WORKPLACE_MEMBERSHIP];
const VALUE_JOURNALS = [...SETTLER_VALUES, ...WORKPLACE_VALUES];

const indexes = new WeakMap<World, WorkforceIndex>();
const NO_CREW: readonly Entity[] = Object.freeze([]);
const idOf = (e: Entity): number => e;

/**
 * The employed settlers' crews and inbound loads as of this call. The crews are the live index, valid
 * until the next call brings it up to date; the loads are checked against stock now and kept.
 */
export function workshopWorkforce(world: World, ctx: SystemContext): WorkshopWorkforce {
  return new WorkshopWorkforce(world, ctx, caughtUp(world, ctx));
}

/** A phase-local snapshot of the employed settlers: each workshop's crew and its inbound loads. */
export class WorkshopWorkforce {
  private readonly inbound = new Map<Entity, SupplyLoad[]>();
  private readonly epoch: number;

  constructor(
    world: World,
    ctx: SystemContext,
    private readonly index: WorkforceIndex,
  ) {
    this.epoch = index.epoch;
    for (const settler of index.loaders) {
      const binding = index.bindings.get(settler);
      const load = binding?.load;
      if (binding === undefined || load === undefined || load === null) continue;
      if (!inboundCounts(world, ctx, binding.workplace, load)) continue;
      let loads = this.inbound.get(binding.workplace);
      if (loads === undefined) {
        loads = [];
        this.inbound.set(binding.workplace, loads);
      }
      loads.push({ settler, goodType: load.goodType, amount: load.amount });
    }
  }

  operatorsAt(workplace: Entity): readonly Entity[] {
    if (this.index.epoch !== this.epoch) throw new Error('WorkshopWorkforce read after a newer snapshot');
    return this.index.crews.get(workplace) ?? NO_CREW;
  }

  /** Units of `goodType` the indexed loads bring to `workplace`, leaving out the settlers `skip` names. */
  incomingOf(workplace: Entity, goodType: number, skip?: (settler: Entity) => boolean): number {
    let units = 0;
    for (const load of this.inbound.get(workplace) ?? []) {
      if (load.goodType === goodType && skip?.(load.settler) !== true) units += load.amount;
    }
    return units;
  }
}

/** Whether a bound load still counts: a pickup leg's source holds the good (on its arrival tick too,
 *  before the planner starts the pickup there), and the workplace has shelf room for it. */
function inboundCounts(world: World, ctx: SystemContext, workplace: Entity, load: BoundLoad): boolean {
  const source = load.source;
  if (source !== null && (accessibleStockAmounts(world, source)?.get(load.goodType) ?? 0) <= 0) return false;
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
  let load: BoundLoad | null = null;
  if (carried !== undefined) load = { goodType: carried.goodType, amount: carried.amount, source: null };
  else if (run !== undefined && run.site === workplace && run.source !== null) {
    load = { goodType: run.goodType, amount: run.amount, source: run.source };
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
  const dirty = new Set<Entity>(held.untracked);
  for (const component of SETTLER_MEMBERSHIP) {
    const deltas = world.membershipDeltasSince(component, held.generations.get(component) ?? 0);
    if (deltas === null) return rebuild(world, ctx);
    for (const e of deltas) dirty.add(e);
  }
  for (const component of SETTLER_VALUES) {
    const deltas = world.valueWritesSince(component, held.valueGenerations.get(component) ?? 0);
    if (deltas === null) return rebuild(world, ctx);
    for (const e of deltas) dirty.add(e);
  }
  for (const component of WORKPLACE_MEMBERSHIP) {
    const deltas = world.membershipDeltasSince(component, held.generations.get(component) ?? 0);
    if (deltas === null) return rebuild(world, ctx);
    for (const e of deltas) for (const worker of assignedWorkers(world, e)) dirty.add(worker);
  }
  for (const component of WORKPLACE_VALUES) {
    const deltas = world.valueWritesSince(component, held.valueGenerations.get(component) ?? 0);
    if (deltas === null) return rebuild(world, ctx);
    for (const e of deltas) for (const worker of assignedWorkers(world, e)) dirty.add(worker);
  }
  const trades = settlerTradeLog(world);
  for (const e of trades) dirty.add(e);
  trades.clear();
  noteGenerations(world, held);
  if (dirty.size === 0) return held;
  for (const e of dirty) resync(world, ctx, held, e);
  held.epoch++;
  return held;
}

function rebuild(world: World, ctx: SystemContext): WorkforceIndex {
  for (const component of MEMBERSHIP_JOURNALS) world.journalMembership(component);
  for (const component of VALUE_JOURNALS) world.journalValueWrites(component);
  settlerTradeLog(world).clear();
  const index = deriveIndex(world, ctx, (indexes.get(world)?.epoch ?? 0) + 1);
  indexes.set(world, index);
  return index;
}

function deriveIndex(world: World, ctx: SystemContext, epoch: number): WorkforceIndex {
  const index: WorkforceIndex = {
    ctx,
    generations: new Map(),
    valueGenerations: new Map(),
    bindings: new Map(),
    crews: new Map(),
    loaders: new Set(),
    untracked: new Set(),
    epoch,
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
    index.loaders.delete(e);
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
  if (binding.load !== null) index.loaders.add(e);
  if (!binding.operator) return;
  const crew = index.crews.get(binding.workplace);
  if (crew === undefined) index.crews.set(binding.workplace, [e]);
  else insertSortedById(crew, e, idOf);
}

/** Brings the held index up to date, then compares it with a fresh derivation: a missed dependency
 *  shows up as a binding the journals never re-derived. */
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
