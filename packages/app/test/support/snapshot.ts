import { fx, type WorldSnapshot } from '@open-northland/sim';

/**
 * Shared builders for the synthetic {@link WorldSnapshot}s the pure snapshot→view projections are tested
 * against (door badges, geometry-debug items, map-start focus, the vertical-slice scene assembly). These
 * shape a snapshot by hand — the sim never runs — so a test can pin exactly the entities/components its
 * projection reads. Kept as small composable builders (not one mega-builder) so each test keeps only the
 * components it asserts on.
 */

/** A hand-built snapshot entity: an id + its raw component bag (each projection reads the keys it needs). */
export interface Ent {
  readonly id: number;
  readonly components: Record<string, unknown>;
}

/** Wrap hand-built entities as a tick-0 `WorldSnapshot` (the cast skips the sim's private snapshot shape). */
export function snapshotOf(entities: readonly Ent[]): WorldSnapshot {
  return { tick: 0, entities, events: [] } as unknown as WorldSnapshot;
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
