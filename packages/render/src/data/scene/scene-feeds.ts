import {
  type EntitySnapshot,
  indexesOf,
  ONE,
  type SnapshotIndexSpec,
  type TileBox,
  TileBuckets,
  type WorldSnapshot,
} from '@open-northland/sim';
import { isSelfContainedKind } from './item-memo.js';
import { classify } from './snapshot-readers/index.js';

/**
 * The per-change feeds an incremental scene build reads: which entities a delta touched, and where the
 * entities stand whose draw items must be built afresh each build.
 */

/** The ids of the self-contained entities (`SceneItemMemo`'s kinds, before or after the change) added,
 *  removed or replaced since a build last cleared it. A log rather than a view, so it differs from a
 *  fresh walk by design. */
export interface TouchedIds {
  readonly ids: Set<number>;
}

function selfContained(entity: EntitySnapshot): boolean {
  const kind = classify(entity.components);
  return kind !== null && isSelfContainedKind(kind);
}

function log(state: TouchedIds, entity: EntitySnapshot): void {
  if (selfContained(entity)) state.ids.add(entity.id);
}

const TOUCHED: SnapshotIndexSpec<TouchedIds> = {
  name: 'scene touched ids',
  empty: () => ({ ids: new Set() }),
  add: log,
  remove: log,
  replace: (state, previous, next) => {
    if (selfContained(previous) || selfContained(next)) state.ids.add(next.id);
  },
  differs: () => null,
};

/** The touch log over `snapshot`'s lineage. A new object means a new lineage (a rebuilt mirror, a
 *  snapshot taken straight off a simulation), whose log names every entity. */
export function touchedIdsOf(snapshot: WorldSnapshot): TouchedIds {
  return indexesOf(snapshot).get(TOUCHED);
}

function positionOf(entity: EntitySnapshot): { readonly x: number; readonly y: number } | null {
  const pos = entity.components.Position as { x?: unknown; y?: unknown } | undefined;
  if (pos === undefined || typeof pos.x !== 'number' || typeof pos.y !== 'number') return null;
  return pos as { readonly x: number; readonly y: number };
}

/** Whether a scene build re-emits `entity` every build: a positioned drawable whose item reads more
 *  than its own components. */
function rebuiltEachBuild(entity: EntitySnapshot): boolean {
  const kind = classify(entity.components);
  return kind !== null && !isSelfContainedKind(kind);
}

function place(buckets: TileBuckets<EntitySnapshot>, entity: EntitySnapshot): void {
  const pos = positionOf(entity);
  if (pos !== null && rebuiltEachBuild(entity)) buckets.set(entity.id, entity, pos.x / ONE, pos.y / ONE);
  else buckets.delete(entity.id);
}

/** The positioned entities that are not self-contained kinds, bucketed like the position index: what
 *  an incremental build queries instead of every positioned entity. */
const REBUILT_POSITIONS: SnapshotIndexSpec<TileBuckets<EntitySnapshot>> = {
  name: 'scene rebuilt positions',
  empty: () => new TileBuckets(),
  differs: (held, fresh) => held.differenceFrom(fresh),
  add: place,
  remove: (buckets, entity) => {
    buckets.delete(entity.id);
  },
  replace: (buckets, _previous, next) => place(buckets, next),
};

/** {@link REBUILT_POSITIONS} written over `out` from index 0, returning the count. */
export function collectRebuiltPositioned(
  snapshot: WorldSnapshot,
  box: TileBox,
  out: EntitySnapshot[],
): number {
  return indexesOf(snapshot).get(REBUILT_POSITIONS).collect(box, out);
}
