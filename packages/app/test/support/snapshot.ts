import { fx, type WorldSnapshot } from '@open-northland/sim';

/**
 * Shared fixtures for the pure snapshot→view projections: small composable builders that shape a
 * {@link WorldSnapshot} by hand — the sim never runs — so a test pins exactly the entities and components
 * its projection reads, plus two counting wrappers: reads of the entity lane (what a per-frame memo is
 * measured against) and entities actually handed out (what tells a world scan from a lookup).
 */

/** A hand-built snapshot entity: an id + its raw component bag (each projection reads the keys it needs). */
export interface Ent {
  readonly id: number;
  readonly components: Record<string, unknown>;
}

/** Wrap hand-built entities as a `WorldSnapshot`, canonicalized to the ascending-id order
 *  `takeSnapshot` guarantees and `entityById` binary-searches. The cast skips the sim's private
 *  snapshot shape. */
export function snapshotOf(entities: readonly Ent[], tick = 0): WorldSnapshot {
  const canonical = [...entities].sort((a, b) => a.id - b.id);
  return { tick, entities: canonical, events: [] } as unknown as WorldSnapshot;
}

/** An empty tick-0 snapshot — the "no entities" case (a bare scene assembly). */
export const EMPTY_SNAPSHOT: WorldSnapshot = { tick: 0, entities: [], events: [] };

/** A building entity of type `typeId` at tile `(x, y)`. */
export function building(id: number, typeId: number, x: number, y: number): Ent {
  return {
    id,
    components: { Building: { buildingType: typeId }, Position: { x: fx.fromInt(x), y: fx.fromInt(y) } },
  };
}

/** A settler of job `jobType`, optionally bound to `workplace` (a `JobAssignment`). */
export function settler(id: number, jobType: number, workplace: number | null): Ent {
  return {
    id,
    components: {
      Settler: { jobType },
      ...(workplace !== null ? { JobAssignment: { workplace } } : {}),
    },
  };
}

/** An adult settler living in home building `home` (a `Residence`) — one household dot on that home. */
export function resident(id: number, jobType: number, home: number): Ent {
  return { id, components: { Settler: { jobType }, Residence: { home } } };
}

/**
 * A snapshot that counts every read of `entities` — the O(N) lane every projection walks, and the seam a
 * per-frame memo has to stop hitting. Compare counts relatively; the absolute number is an implementation
 * detail of the projection under test.
 */
export function countingSnapshot(source: WorldSnapshot): {
  snapshot: WorldSnapshot;
  scans: () => number;
} {
  let scans = 0;
  return {
    snapshot: {
      ...source,
      get entities() {
        scans++;
        return source.entities;
      },
    },
    scans: () => scans,
  };
}

/**
 * A snapshot that counts every ENTITY it hands out, not every read of the lane — the measure that tells a
 * probe driven by the world apart from one driven by its own small input (a selection, a work list).
 */
export function visitCountingSnapshot(source: WorldSnapshot): {
  snapshot: WorldSnapshot;
  visits: () => number;
} {
  let visits = 0;
  const entities = new Proxy(source.entities, {
    get(target, key, receiver) {
      if (typeof key === 'string' && String(Number(key)) === key) visits++;
      return Reflect.get(target, key, receiver);
    },
  });
  return { snapshot: { ...source, entities }, visits: () => visits };
}
