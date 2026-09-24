import { JobAssignment } from '../../components/index.js';
import { insertSortedById, removeSortedById } from '../../core/sorted-id.js';
import type { Entity, World } from '../../ecs/world.js';

/**
 * Every workplace's bound settlers, kept across ticks by replaying the {@link JobAssignment} membership
 * journal. The component is only ever added or removed, and a rebind re-adds it, so membership changes
 * cover every value it holds.
 */
interface AssignedIndex {
  generation: number;
  readonly workplaceOf: Map<Entity, Entity>;
  /** Ascending id per workplace. */
  readonly byWorkplace: Map<Entity, Entity[]>;
}

const indexes = new WeakMap<World, AssignedIndex>();
const NO_WORKERS: readonly Entity[] = Object.freeze([]);
const idOf = (e: Entity): number => e;

/** The settlers whose {@link JobAssignment} names `workplace`, ascending id, whether or not the workplace
 *  still exists. Shared: never mutate it. */
export function assignedWorkers(world: World, workplace: Entity): readonly Entity[] {
  return assignedIndex(world).byWorkplace.get(workplace) ?? NO_WORKERS;
}

function assignedIndex(world: World): AssignedIndex {
  const generation = world.componentGeneration(JobAssignment);
  let index = indexes.get(world);
  if (index === undefined) {
    index = deriveIndex(world);
    indexes.set(world, index);
    world.registerCacheVerifier('assignedWorkers', () => verifyIndex(world));
    return index;
  }
  if (index.generation === generation) return index;
  const deltas = world.membershipDeltasSince(JobAssignment, index.generation);
  if (deltas === null) {
    index = deriveIndex(world);
    indexes.set(world, index);
    return index;
  }
  for (const e of deltas) resync(world, index, e);
  index.generation = generation;
  return index;
}

function deriveIndex(world: World): AssignedIndex {
  world.journalMembership(JobAssignment);
  const index: AssignedIndex = {
    generation: world.componentGeneration(JobAssignment),
    workplaceOf: new Map(),
    byWorkplace: new Map(),
  };
  for (const e of world.canonicalQuery(JobAssignment)) admit(index, e, world.get(e, JobAssignment).workplace);
  return index;
}

/** Replay one journal entry from live state; idempotent, so repeated entries for one settler converge. */
function resync(world: World, index: AssignedIndex, e: Entity): void {
  const held = index.workplaceOf.get(e);
  const workplace = world.tryGet(e, JobAssignment)?.workplace;
  if (held === workplace) return;
  if (held !== undefined) {
    const workers = index.byWorkplace.get(held);
    if (workers !== undefined && removeSortedById(workers, e, idOf) && workers.length === 0) {
      index.byWorkplace.delete(held);
    }
    index.workplaceOf.delete(e);
  }
  if (workplace !== undefined) admit(index, e, workplace);
}

function admit(index: AssignedIndex, e: Entity, workplace: Entity): void {
  index.workplaceOf.set(e, workplace);
  const workers = index.byWorkplace.get(workplace);
  if (workers === undefined) index.byWorkplace.set(workplace, [e]);
  else insertSortedById(workers, e, idOf);
}

/** Only an index current with the store is compared; a stale one catches up on its next read. */
function verifyIndex(world: World): string[] {
  const held = indexes.get(world);
  if (held === undefined || held.generation !== world.componentGeneration(JobAssignment)) return [];
  const fresh = deriveIndex(world);
  if (fresh.byWorkplace.size !== held.byWorkplace.size) {
    return ['assignedWorkers lists a different set of workplaces than a fresh JobAssignment scan'];
  }
  for (const [workplace, workers] of fresh.byWorkplace) {
    const listed = held.byWorkplace.get(workplace) ?? NO_WORKERS;
    if (listed.length !== workers.length || listed.some((e, i) => e !== workers[i])) {
      return [`assignedWorkers disagrees with a fresh JobAssignment scan at workplace ${workplace}`];
    }
  }
  return [];
}
