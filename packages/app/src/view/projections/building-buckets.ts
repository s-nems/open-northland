import { ONE } from '@open-northland/render/data';
import {
  type EntitySnapshot,
  indexesOf,
  type SnapshotIndexSpec,
  type TileBox,
  TileBuckets,
  type WorldSnapshot,
} from '@open-northland/sim';
import { positionOf, type SnapshotEntity } from '../../game/snapshot/index.js';

/** The buildings bucketed by their `Position`, so a screen query meets buildings only, not the walkers
 *  around them. Only gaining or losing either component replaces an entry; any other write lands in
 *  `swapAll`, which re-buckets a held building with its new object. */
const BUILDINGS_BY_POSITION: SnapshotIndexSpec<TileBuckets<EntitySnapshot>> = {
  name: 'building position buckets',
  reads: { presence: ['Building', 'Position'] },
  empty: () => new TileBuckets(),
  differs: (held, fresh) => held.differenceFrom(fresh),
  add: (buckets, entity) => {
    const pos = positionOf(entity);
    if (pos !== undefined && entity.components.Building !== undefined) {
      buckets.set(entity.id, entity, pos.x / ONE, pos.y / ONE);
    }
  },
  remove: (buckets, entity) => {
    buckets.delete(entity.id);
  },
  // Most touched entities are ones this index never holds.
  swapAll: (buckets, nexts, current) => {
    buckets.eachHeld(nexts, current, (next) => {
      const pos = positionOf(next);
      if (pos !== undefined) buckets.move(next.id, next, pos.x / ONE, pos.y / ONE);
    });
  },
};

/** Reused output of the box query; the slots past a query's count hold earlier frames' bodies. */
const boxed: SnapshotEntity[] = [];

/** The buildings standing in `box`'s position buckets, ascending by id. */
export function buildingsIn(snapshot: WorldSnapshot, box: TileBox): SnapshotEntity[] {
  const count = indexesOf(snapshot).get(BUILDINGS_BY_POSITION).collect(box, boxed);
  const buildings = boxed.slice(0, count) as SnapshotEntity[];
  return buildings.sort((a, b) => a.id - b.id);
}
