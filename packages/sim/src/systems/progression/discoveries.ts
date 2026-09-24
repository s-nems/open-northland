import { type ContentSet, houseDiscoveryGoods, type TribeType } from '@open-northland/data';
import {
  AiPlayer,
  discoverTechnology,
  isAiPlayer,
  MapPermissions,
  Owner,
  ownerOf,
  Person,
  professionProgressionEnabled,
  ScriptUnlocks,
  Settler,
  type SettlerView,
  settlerProgressLog,
  technologyDiscovered,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Component, Entity, World } from '../../ecs/world.js';
import type { System } from '../context.js';
import { canonicalById } from '../spatial/nodes.js';
import { goodEnabled, jobEnabled, settlerMeetsNeed, typeAllowed } from './unlocks.js';

/** What a settler's last discovery walk saw of it: the walk repeats only when one of these moves.
 *  Experience and the learned lists only grow, so their sums and lengths tell every change. */
interface DiscoveryInput {
  readonly owner: number | undefined;
  readonly tribe: number;
  readonly jobType: number;
  readonly experience: number;
  readonly learnedJobs: number;
  readonly learnedGoods: number;
  readonly permissions: string;
}

/**
 * The sweep's memory of one world: each walked settler's last input, and what can have moved an input
 * since the last pass - the progress log of in-place trade, experience and learned writes, the membership
 * journals of {@link MEMBERSHIP_INPUTS} past the recorded generations, and the permission key.
 */
interface DiscoveryMemo {
  readonly inputs: Map<Entity, DiscoveryInput>;
  readonly writes: Set<Entity>;
  readonly generations: Map<Component<unknown>, number>;
  permissions: string;
}

/** The stores whose membership moves an input: Person and Settler decide who is walked (a re-added
 *  Settler carries a new tribe and lists), Owner the player a settler discovers for. */
const MEMBERSHIP_INPUTS: readonly Component<unknown>[] = [Person, Settler, Owner];

const memos = new WeakMap<World, DiscoveryMemo>();

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

function permissionKey(world: World): string {
  return `${world.componentGeneration(AiPlayer)}:${world.componentValueGeneration(AiPlayer)}:${world.componentGeneration(ScriptUnlocks)}:${world.componentValueGeneration(ScriptUnlocks)}:${world.componentGeneration(MapPermissions)}:${world.componentValueGeneration(MapPermissions)}`;
}

/** One read of a walked settler: its discovery input, its view and its tribe's content row. */
interface DiscoveryRead {
  readonly input: DiscoveryInput;
  readonly settler: SettlerView;
  readonly jobType: number;
  readonly tribe: TribeType;
}

/** Read a settler's discovery input, or null when the sweep does not walk it: not a person, jobless, or
 *  of a tribe whose professions enable nothing. */
function readSettler(
  world: World,
  content: ContentSet,
  entity: Entity,
  permissions: string,
): DiscoveryRead | null {
  if (!world.has(entity, Person)) return null;
  const settler = world.tryGet(entity, Settler);
  if (settler === undefined || settler.jobType === null) return null;
  const tribe = contentIndex(content).tribes.get(settler.tribe);
  if (tribe === undefined || tribe.jobEnables.length === 0) return null;
  const input: DiscoveryInput = {
    owner: ownerOf(world, entity),
    tribe: settler.tribe,
    jobType: settler.jobType,
    experience: experienceSum(settler.experience),
    learnedJobs: settler.learned?.job.length ?? 0,
    learnedGoods: settler.learned?.good.length ?? 0,
    permissions,
  };
  return { input, settler, jobType: settler.jobType, tribe };
}

/** The settlers whose input may have moved since the last pass, or null when every settler must be
 *  re-read: a changed permission key, or a journal that no longer covers the span. */
function pendingSettlers(world: World, memo: DiscoveryMemo, permissions: string): Set<Entity> | null {
  if (memo.permissions !== permissions) return null;
  const pending = new Set(memo.writes);
  for (const component of MEMBERSHIP_INPUTS) {
    const since = memo.generations.get(component);
    const deltas = since === undefined ? null : world.membershipDeltasSince(component, since);
    if (deltas === null) return null;
    for (const entity of deltas) pending.add(entity);
  }
  return pending;
}

/** `world`'s memo, opened with its journals, progress log and cache verifier on first use. */
function discoveryMemo(world: World, content: ContentSet): DiscoveryMemo {
  const held = memos.get(world);
  if (held !== undefined) return held;
  for (const component of MEMBERSHIP_INPUTS) world.journalMembership(component);
  const memo: DiscoveryMemo = {
    inputs: new Map(),
    writes: settlerProgressLog(world),
    generations: new Map(),
    permissions: '',
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
  const permissions = permissionKey(world);
  const pending = pendingSettlers(world, memo, permissions);
  if (pending === null) return []; // the next pass re-reads everyone
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

/** Discoveries belong to the player and survive losing or retraining the worker who earned them. */
export const technologySystem: System = (world, ctx) => {
  if (!professionProgressionEnabled(world)) return;
  const memo = discoveryMemo(world, ctx.content);
  const permissions = permissionKey(world);
  const pending = pendingSettlers(world, memo, permissions);
  // A pass walks the settlers in ascending id, which attributes a shared discovery to the lowest; one
  // whose input is unchanged would walk to nothing new, so only the pending ones are read.
  const candidates =
    pending === null ? canonicalById(world.query(Person, Settler)) : [...pending].sort((a, b) => a - b);
  if (pending === null) {
    for (const entity of memo.inputs.keys()) {
      if (!world.has(entity, Person) || !world.has(entity, Settler)) memo.inputs.delete(entity);
    }
  }
  memo.writes.clear();
  for (const component of MEMBERSHIP_INPUTS) {
    memo.generations.set(component, world.componentGeneration(component));
  }
  memo.permissions = permissions;
  const discover = (
    entity: Entity | undefined,
    owner: number | undefined,
    tribe: number,
    kind: 'job' | 'good' | 'house',
    typeId: number,
  ): boolean => {
    if (!discoverTechnology(world, owner, tribe, kind, typeId)) return false;
    if (entity !== undefined && owner !== undefined && ctx.tick > 1)
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
    let advanced: boolean;
    do {
      advanced = false;
      for (const row of tribe.technology.houses) {
        if (technologyDiscovered(world, owner, tribeId, 'house', row.house)) continue;
        if (!typeAllowed(world, ctx, owner, tribeId, 'house', row.house)) continue;
        if (
          !(owner !== undefined && isAiPlayer(world, owner)) &&
          (!row.jobs.every((id) => jobEnabled(world, ctx, owner, tribeId, id)) ||
            !row.goods.every((id) => goodEnabled(world, ctx, owner, tribeId, id)))
        )
          continue;
        advanced = discover(entity, owner, tribeId, 'house', row.house) || advanced;
        for (const good of houseDiscoveryGoods(ctx.content, row.house))
          discover(entity, owner, tribeId, 'good', good);
      }
    } while (advanced);
  };
  for (const entity of candidates) {
    const read = readSettler(world, ctx.content, entity, permissions);
    if (read === null) {
      memo.inputs.delete(entity);
      continue;
    }
    if (sameInput(memo.inputs.get(entity), read.input)) continue;
    memo.inputs.set(entity, read.input);
    const { settler: s, jobType, tribe } = read;
    const owner = read.input.owner;
    const subject = { owner, tribe: s.tribe, experience: s.experience, learned: s.learned };
    if (settlerMeetsNeed(world, ctx, subject, 'job', jobType)) {
      discover(entity, owner, s.tribe, 'job', jobType);
    }
    for (const edge of tribe.jobEnables) {
      if (edge.jobType !== jobType || edge.kind === 'vehicle') continue;
      if (!typeAllowed(world, ctx, owner, s.tribe, edge.kind, edge.targetId)) continue;
      if (edge.kind === 'house' && tribe.technology !== undefined) continue;
      if (edge.kind !== 'house' && !settlerMeetsNeed(world, ctx, subject, edge.kind, edge.targetId)) continue;
      discover(entity, owner, s.tribe, edge.kind, edge.targetId);
      if (edge.kind === 'job') {
        for (const product of tribe.jobEnables) {
          if (product.kind !== 'good' || product.jobType !== edge.targetId) continue;
          if (settlerMeetsNeed(world, ctx, subject, 'good', product.targetId))
            discover(entity, owner, s.tribe, 'good', product.targetId);
        }
      }
    }
    advanceHouses(entity, owner, s.tribe);
  }
};
