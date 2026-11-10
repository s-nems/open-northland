import { type ContentSet, houseDiscoveryGoods, type TribeType } from '@open-northland/data';
import {
  AiControl,
  discoverTechnology,
  MapPermissions,
  Owner,
  ownerOf,
  Person,
  PlayerPlacementRules,
  professionProgressionEnabled,
  ScriptUnlocks,
  SeatTribeUnlocks,
  Settler,
  SettlerProgress,
  type SettlerProgressView,
  type SettlerView,
  settlerProgressLog,
  technologyDiscovered,
  tribeUnlockedFor,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Component, Entity, World } from '../../ecs/world.js';
import type { ContentContext, System } from '../context.js';
import {
  goodEnabled,
  jobAwaitsDiscovery,
  jobEnabled,
  settlerMeetsNeed,
  technologyUnlockGeneration,
  typeAllowed,
} from './unlocks.js';

/** What a settler's last discovery walk saw of it: the walk repeats only when one of these moves.
 *  Experience and the learned lists only grow, so their sums and lengths tell every change. */
interface DiscoveryInput {
  readonly owner: number | undefined;
  readonly tribe: number;
  readonly jobType: number;
  readonly experience: number;
  readonly learnedJobs: number;
  readonly learnedGoods: number;
  /** The {@link DiscoveryMemo.permissions} epoch the walk ran under. */
  readonly permissions: number;
}

/**
 * The sweep's memory of one world: each walked settler's last input, and what can have moved an input
 * since the last pass - the progress log of in-place trade, experience and learned writes, the membership
 * journals of {@link MEMBERSHIP_INPUTS} past the recorded generations, and the permission key.
 */
interface DiscoveryMemo {
  readonly inputs: Map<Entity, DiscoveryInput>;
  readonly writes: Set<Entity>;
  /** The last {@link pendingSettlers} list, its storage reused by the next. */
  readonly pending: Entity[];
  pendingCount: number;
  readonly notePending: (entity: Entity) => void;
  readonly generations: Map<Component<unknown>, number>;
  /** Counts the changes of the {@link PERMISSION_INPUTS} generations, held in `permissionGenerations`. */
  permissions: number;
  readonly permissionGenerations: number[];
  /** The owners and tribes whose last house walk discovered nothing. A re-walk reads only the stores
   *  {@link technologyUnlockGeneration} sums, so it discovers nothing again until that number moves. */
  readonly settledHouses: Map<number | undefined, Set<number>>;
  settledContent: ContentSet | null;
  settledGeneration: number;
}

/** The stores whose membership moves an input: Person and Settler decide who is walked (a re-added
 *  Settler carries a new tribe, a re-added SettlerProgress new lists), Owner the player a settler
 *  discovers for. */
const MEMBERSHIP_INPUTS: readonly Component<unknown>[] = [Person, Settler, SettlerProgress, Owner];

const memos = new WeakMap<World, DiscoveryMemo>();

/** The tick authored setup lands on: a world's starting trades are discovered then, and are not news. */
const SETUP_TICK = 1;

function experienceSum(experience: ReadonlyMap<number, number>): number {
  let sum = 0;
  for (const amount of experience.values()) sum += amount;
  return sum;
}

function sameInput(a: DiscoveryInput | undefined, b: DiscoveryInput): boolean {
  return (
    a !== undefined &&
    a.owner === b.owner &&
    a.tribe === b.tribe &&
    a.jobType === b.jobType &&
    a.experience === b.experience &&
    a.learnedJobs === b.learnedJobs &&
    a.learnedGoods === b.learnedGoods &&
    a.permissions === b.permissions
  );
}

/** The stores whose any change re-reads every settler: the gates a discovery reads, and the seats'
 *  unlocked tribes, since a settler of a tribe its seat has not unlocked is not walked at all. */
const PERMISSION_INPUTS: readonly Component<unknown>[] = [
  AiControl,
  ScriptUnlocks,
  MapPermissions,
  PlayerPlacementRules,
  SeatTribeUnlocks,
];

/** The permission epoch now: the memo's while no {@link PERMISSION_INPUTS} generation moved since it
 *  was recorded, the next one otherwise. Generations only grow, so no earlier epoch returns. */
function permissionEpoch(world: World, memo: DiscoveryMemo): number {
  const held = memo.permissionGenerations;
  for (let i = 0; i < PERMISSION_INPUTS.length; i++) {
    const store = PERMISSION_INPUTS[i] as Component<unknown>;
    if (
      held[2 * i] !== world.componentGeneration(store) ||
      held[2 * i + 1] !== world.componentValueGeneration(store)
    )
      return memo.permissions + 1;
  }
  return memo.permissions;
}

function recordPermissions(world: World, memo: DiscoveryMemo, epoch: number): void {
  if (memo.permissions === epoch) return;
  memo.permissions = epoch;
  for (let i = 0; i < PERMISSION_INPUTS.length; i++) {
    const store = PERMISSION_INPUTS[i] as Component<unknown>;
    memo.permissionGenerations[2 * i] = world.componentGeneration(store);
    memo.permissionGenerations[2 * i + 1] = world.componentValueGeneration(store);
  }
}

/** One read of a walked settler: its discovery input, its view and its tribe's content row. */
interface DiscoveryRead {
  readonly input: DiscoveryInput;
  readonly settler: SettlerView;
  readonly progress: SettlerProgressView;
  readonly jobType: number;
  readonly tribe: TribeType;
}

/** Read a settler's discovery input, or null when the sweep does not walk it: not a person, jobless, of
 *  a tribe whose professions enable nothing, or of one its seat has not unlocked. */
function readSettler(
  world: World,
  content: ContentSet,
  entity: Entity,
  permissions: number,
): DiscoveryRead | null {
  if (!world.has(entity, Person)) return null;
  const settler = world.tryGet(entity, Settler);
  if (settler === undefined || settler.jobType === null) return null;
  const tribe = contentIndex(content).tribes.get(settler.tribe);
  if (tribe === undefined || tribe.jobEnables.length === 0) return null;
  const owner = ownerOf(world, entity);
  if (!tribeUnlockedFor(world, owner, settler.tribe)) return null;
  const progress = world.get(entity, SettlerProgress);
  const input: DiscoveryInput = {
    owner,
    tribe: settler.tribe,
    jobType: settler.jobType,
    experience: experienceSum(progress.experience),
    learnedJobs: progress.learned?.job.length ?? 0,
    learnedGoods: progress.learned?.good.length ?? 0,
    permissions,
  };
  return { input, settler, progress, jobType: settler.jobType, tribe };
}

/** The settlers whose input may have moved since the last pass, ascending and once each, or null when
 *  every settler must be re-read: a changed permission key, or a journal that no longer covers the span.
 *  The list is the memo's, valid until the next call. */
function pendingSettlers(world: World, memo: DiscoveryMemo, permissions: number): readonly Entity[] | null {
  if (memo.permissions !== permissions) return null;
  const pending = memo.pending;
  memo.pendingCount = 0;
  memo.writes.forEach(memo.notePending);
  for (let i = 0; i < MEMBERSHIP_INPUTS.length; i++) {
    const component = MEMBERSHIP_INPUTS[i] as Component<unknown>;
    const since = memo.generations.get(component);
    if (since === undefined || !world.replayMembershipSince(component, since, memo.notePending)) return null;
  }
  let count = memo.pendingCount;
  // Written by index and trimmed after: an emptied array drops its storage.
  if (pending.length !== count) pending.length = count;
  if (count < 2) return pending;
  pending.sort(ascendingId);
  let kept = 1;
  for (let i = 1; i < count; i++) {
    const entity = pending[i] as Entity;
    if (entity !== pending[kept - 1]) pending[kept++] = entity;
  }
  count = kept;
  if (pending.length !== count) pending.length = count;
  return pending;
}

const ascendingId = (a: Entity, b: Entity): number => a - b;

/** `world`'s memo, opened with its journals, progress log and cache verifier on first use. */
function discoveryMemo(world: World, content: ContentSet): DiscoveryMemo {
  const held = memos.get(world);
  if (held !== undefined) return held;
  for (const component of MEMBERSHIP_INPUTS) world.journalMembership(component);
  const pending: Entity[] = [];
  const memo: DiscoveryMemo = {
    inputs: new Map(),
    writes: settlerProgressLog(world),
    pending,
    pendingCount: 0,
    notePending: (entity) => {
      pending[memo.pendingCount++] = entity;
    },
    generations: new Map(),
    permissions: 0,
    permissionGenerations: [],
    settledHouses: new Map(),
    settledContent: null,
    settledGeneration: 0,
  };
  memos.set(world, memo);
  world.registerCacheVerifier('technologyInputs', () => verifyDiscoveryMemo(world, content, memo));
  return memo;
}

/**
 * Re-derive every settler the next pass would skip and report one whose input moved anyway: a write
 * of its trade, experience or learned lists that bypassed `noteSettlerProgress`.
 */
function verifyDiscoveryMemo(world: World, content: ContentSet, memo: DiscoveryMemo): string[] {
  const permissions = permissionEpoch(world, memo);
  const listed = pendingSettlers(world, memo, permissions);
  if (listed === null) return []; // the next pass re-reads everyone
  const pending = new Set(listed);
  const violations: string[] = [];
  const skipped = new Set(memo.inputs.keys());
  for (const entity of world.query(Person, Settler)) skipped.add(entity);
  for (const entity of skipped) {
    if (pending.has(entity)) continue;
    const read = readSettler(world, content, entity, permissions);
    const held = memo.inputs.get(entity);
    if (read === null ? held !== undefined : !sameInput(held, read.input)) {
      violations.push(`technology: settler ${entity} changed its discovery input without a progress note`);
    }
  }
  return violations;
}

const discoveryGoods = new WeakMap<ContentSet, Map<number, readonly number[]>>();

/** {@link houseDiscoveryGoods}, kept per content set and house type. */
function discoveryGoodsOf(content: ContentSet, houseType: number): readonly number[] {
  let byHouse = discoveryGoods.get(content);
  if (byHouse === undefined) {
    byHouse = new Map();
    discoveryGoods.set(content, byHouse);
  }
  let goods = byHouse.get(houseType);
  if (goods === undefined) {
    goods = houseDiscoveryGoods(content, houseType);
    byHouse.set(houseType, goods);
  }
  return goods;
}

function allJobsEnabled(
  world: World,
  ctx: ContentContext,
  owner: number | undefined,
  tribe: number,
  jobs: readonly number[],
): boolean {
  for (const id of jobs) if (!jobEnabled(world, ctx, owner, tribe, id)) return false;
  return true;
}

function allGoodsEnabled(
  world: World,
  ctx: ContentContext,
  owner: number | undefined,
  tribe: number,
  goods: readonly number[],
): boolean {
  for (const id of goods) if (!goodEnabled(world, ctx, owner, tribe, id)) return false;
  return true;
}

/** Discoveries belong to the player and survive losing or retraining the worker who earned them. */
export const technologySystem: System = (world, ctx) => {
  if (!professionProgressionEnabled(world)) return;
  const memo = discoveryMemo(world, ctx.content);
  const permissions = permissionEpoch(world, memo);
  const pending = pendingSettlers(world, memo, permissions);
  // A pass walks the settlers in ascending id, which attributes a shared discovery to the lowest; one
  // whose input is unchanged would walk to nothing new, so only the pending ones are read.
  const candidates = pending ?? world.canonicalQuery(Person, Settler);
  if (pending === null) {
    for (const entity of memo.inputs.keys()) {
      if (!world.has(entity, Person) || !world.has(entity, Settler)) memo.inputs.delete(entity);
    }
  }
  // An empty one is left alone: a long-lived set allocates a fresh table on every clear.
  if (memo.writes.size > 0) memo.writes.clear();
  for (const component of MEMBERSHIP_INPUTS) {
    memo.generations.set(component, world.componentGeneration(component));
  }
  recordPermissions(world, memo, permissions);
  const settledHouses = memo.settledHouses;
  if (memo.settledContent !== ctx.content || memo.settledGeneration !== technologyUnlockGeneration(world)) {
    settledHouses.clear();
  }
  let discoveries = 0;
  const discover = (
    entity: Entity | undefined,
    owner: number | undefined,
    tribe: number,
    kind: 'job' | 'good' | 'house',
    typeId: number,
  ): boolean => {
    if (kind === 'job' && !jobAwaitsDiscovery(ctx, tribe, typeId)) return false;
    if (!discoverTechnology(world, owner, tribe, kind, typeId)) return false;
    discoveries++;
    settledHouses.clear();
    if (entity !== undefined && owner !== undefined && ctx.tick > SETUP_TICK)
      ctx.events.emit({
        kind: 'technologyDiscovered',
        entity,
        player: owner,
        tribe,
        technology: kind,
        typeId,
      });
    return true;
  };
  const advanceHouses = (entity: Entity, owner: number | undefined, tribeId: number): void => {
    const tribe = contentIndex(ctx.content).tribes.get(tribeId);
    if (tribe?.technology === undefined) return;
    if (settledHouses.get(owner)?.has(tribeId) === true) return;
    const before = discoveries;
    let advanced: boolean;
    do {
      advanced = false;
      for (const row of tribe.technology.houses) {
        if (technologyDiscovered(world, owner, tribeId, 'house', row.house)) continue;
        if (!typeAllowed(world, ctx, owner, tribeId, 'house', row.house)) continue;
        if (
          !allJobsEnabled(world, ctx, owner, tribeId, row.jobs) ||
          !allGoodsEnabled(world, ctx, owner, tribeId, row.goods)
        )
          continue;
        advanced = discover(entity, owner, tribeId, 'house', row.house) || advanced;
        for (const good of discoveryGoodsOf(ctx.content, row.house))
          discover(entity, owner, tribeId, 'good', good);
      }
    } while (advanced);
    if (discoveries !== before) return;
    let settled = settledHouses.get(owner);
    if (settled === undefined) {
      settled = new Set();
      settledHouses.set(owner, settled);
    }
    settled.add(tribeId);
  };
  // Indexed, as the edge loops below: `for...of` allocates an iterator result per element on this path.
  for (let c = 0; c < candidates.length; c++) {
    const entity = candidates[c] as Entity;
    const read = readSettler(world, ctx.content, entity, permissions);
    if (read === null) {
      memo.inputs.delete(entity);
      continue;
    }
    if (sameInput(memo.inputs.get(entity), read.input)) continue;
    memo.inputs.set(entity, read.input);
    const { settler: s, progress, jobType, tribe } = read;
    const owner = read.input.owner;
    const subject = { owner, tribe: s.tribe, experience: progress.experience, learned: progress.learned };
    if (settlerMeetsNeed(world, ctx, subject, 'job', jobType)) {
      discover(entity, owner, s.tribe, 'job', jobType);
    }
    const edges = tribe.jobEnables;
    for (let k = 0; k < edges.length; k++) {
      const edge = edges[k];
      if (edge === undefined || edge.jobType !== jobType || edge.kind === 'vehicle') continue;
      if (!typeAllowed(world, ctx, owner, s.tribe, edge.kind, edge.targetId)) continue;
      if (edge.kind === 'house' && tribe.technology !== undefined) continue;
      if (edge.kind !== 'house' && !settlerMeetsNeed(world, ctx, subject, edge.kind, edge.targetId)) continue;
      discover(entity, owner, s.tribe, edge.kind, edge.targetId);
      if (edge.kind === 'job') {
        for (let m = 0; m < edges.length; m++) {
          const product = edges[m];
          if (product === undefined || product.kind !== 'good' || product.jobType !== edge.targetId) continue;
          if (settlerMeetsNeed(world, ctx, subject, 'good', product.targetId))
            discover(entity, owner, s.tribe, 'good', product.targetId);
        }
      }
    }
    advanceHouses(entity, owner, s.tribe);
  }
  memo.settledContent = ctx.content;
  memo.settledGeneration = technologyUnlockGeneration(world);
};
