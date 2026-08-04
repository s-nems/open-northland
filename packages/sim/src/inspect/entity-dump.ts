import type { EntitySnapshot, WorldSnapshot } from './snapshot.js';
import { type ComponentChange, diffComponents } from './snapshot-diff.js';

export interface EntityDump {
  readonly tick: number;
  readonly id: number;
  /** componentName -> plain value, in sorted-name order. */
  readonly components: Readonly<Record<string, unknown>>;
}

export interface EntityTraceStep {
  readonly tick: number;
  /** True when the entity is present in this snapshot. */
  readonly alive: boolean;
  readonly components?: Readonly<Record<string, unknown>>;
  /** True on the first step the entity appears, never on the window's opening step. */
  readonly spawned?: boolean;
  /** True on the first step the entity vanishes. */
  readonly despawned?: boolean;
  /**
   * Changes since the previous step, present only when the entity is alive in both. Same shape and
   * ordering as `diffSnapshots`'s per-entity `changes`.
   */
  readonly changes?: readonly ComponentChange[];
}

/** Binary-search a snapshot's ascending-id entity list for `id`; null when absent. */
function findEntity(snapshot: WorldSnapshot, id: number): EntitySnapshot | null {
  const entities = snapshot.entities;
  let lo = 0;
  let hi = entities.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const e = entities[mid] as EntitySnapshot;
    if (e.id === id) return e;
    if (e.id < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

/** One entity's components at a snapshot's tick, or `null` when it is not alive at that tick. */
export function dumpEntity(snapshot: WorldSnapshot, id: number): EntityDump | null {
  const entity = findEntity(snapshot, id);
  if (entity === null) return null;
  return { tick: snapshot.tick, id, components: entity.components };
}

/**
 * One entity's life state and per-component deltas across a window of snapshots. The snapshots must be
 * in ascending-tick order and the result mirrors that order one-to-one.
 */
export function traceEntity(snapshots: readonly WorldSnapshot[], id: number): EntityTraceStep[] {
  const steps: EntityTraceStep[] = [];
  // `first` keeps the window's opening step from reporting a life edge against the void before it.
  let prev: EntitySnapshot | null = null;
  let first = true;
  for (const snapshot of snapshots) {
    const here = findEntity(snapshot, id);
    if (here !== null) {
      const components = here.components;
      if (prev !== null)
        steps.push({
          tick: snapshot.tick,
          alive: true,
          components,
          changes: diffComponents(prev.components, components),
        });
      else if (first) steps.push({ tick: snapshot.tick, alive: true, components });
      else steps.push({ tick: snapshot.tick, alive: true, components, spawned: true });
    } else if (prev !== null) {
      steps.push({ tick: snapshot.tick, alive: false, despawned: true });
    } else {
      steps.push({ tick: snapshot.tick, alive: false });
    }
    prev = here;
    first = false;
  }
  return steps;
}
