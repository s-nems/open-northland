import {
  type EntitySnapshot,
  firstDifference,
  indexesOf,
  ONE,
  positionOfNode,
  type SnapshotIndexSpec,
  type WorldSnapshot,
} from '@open-northland/sim';
import { entityTile, type TilePoint } from './snapshot.js';

/**
 * The landscape objects the object ambience rolls over, bucketed by map sector and `[GfxLandscape]`
 * record, so a screen's tally reads its visible sectors and never walks the objects themselves.
 */

/** Tiles along a sector's side. Original behavior, unconfirmed in play: the original counts its
 *  ambience objects per sector of 20×20 half-cell nodes, which is 10×10 tiles. */
export const LANDSCAPE_SECTOR_TILES = 10;

/** Sector columns one key row holds: far wider than any map in sectors. */
const SECTOR_KEY_STRIDE = 1 << 16;

/** The key of the sector at sector column `col`, sector row `row`. */
export function sectorKey(col: number, row: number): number {
  return row * SECTOR_KEY_STRIDE + col;
}

function sectorKeyOfTile(tile: TilePoint): number {
  return sectorKey(
    Math.floor(tile.col / LANDSCAPE_SECTOR_TILES),
    Math.floor(tile.row / LANDSCAPE_SECTOR_TILES),
  );
}

/** One sector's objects: `[GfxLandscape]` record index → object id → the tile it stands on. */
export type SectorObjects = Map<number, Map<number, TilePoint>>;

export class LandscapeSectors {
  readonly sectors = new Map<number, SectorObjects>();
  /** Bumped by every add and remove, so a tally kept over the sectors knows when it went stale. */
  revision = 0;

  add(id: number, record: number, tile: TilePoint): void {
    const key = sectorKeyOfTile(tile);
    let sector = this.sectors.get(key);
    if (sector === undefined) {
      sector = new Map();
      this.sectors.set(key, sector);
    }
    let objects = sector.get(record);
    if (objects === undefined) {
      objects = new Map();
      sector.set(record, objects);
    }
    objects.set(id, tile);
    this.revision++;
  }

  remove(id: number, record: number, tile: TilePoint): void {
    const key = sectorKeyOfTile(tile);
    const sector = this.sectors.get(key);
    const objects = sector?.get(record);
    if (sector === undefined || objects === undefined || !objects.delete(id)) return;
    if (objects.size === 0) sector.delete(record);
    if (sector.size === 0) this.sectors.delete(key);
    this.revision++;
  }
}

/** A standing landscape object's record and tile: a sim resource node carrying its record index. */
function standingObject(entity: EntitySnapshot): { record: number; tile: TilePoint } | null {
  const resource = entity.components.Resource as { gfxIndex?: unknown } | undefined;
  if (typeof resource?.gfxIndex !== 'number') return null;
  const tile = entityTile(entity.components);
  return tile === null ? null : { record: resource.gfxIndex, tile };
}

const LANDSCAPE_SECTORS: SnapshotIndexSpec<LandscapeSectors> = {
  name: 'landscape sound sectors',
  // A resource node never moves, so its position is read only when it is placed.
  reads: { values: ['Resource'], presence: ['Position'] },
  empty: () => new LandscapeSectors(),
  add: (sectors, entity) => {
    const object = standingObject(entity);
    if (object !== null) sectors.add(entity.id, object.record, object.tile);
  },
  remove: (sectors, entity) => {
    const object = standingObject(entity);
    if (object !== null) sectors.remove(entity.id, object.record, object.tile);
  },
  // A stroke rewrites a tree's `Resource` without moving or renaming it, the common change here.
  replace: (sectors, previous, next) => {
    const was = standingObject(previous);
    const is = standingObject(next);
    if (
      was !== null &&
      is !== null &&
      was.record === is.record &&
      was.tile.col === is.tile.col &&
      was.tile.row === is.tile.row
    ) {
      return;
    }
    if (was !== null) sectors.remove(previous.id, was.record, was.tile);
    if (is !== null) sectors.add(next.id, is.record, is.tile);
  },
  differs: (held, fresh) => firstDifference(held.sectors, fresh.sectors),
};

/** The sim's standing landscape objects (every resource node carrying its record index) by sector,
 *  kept per change on the snapshot's indexes. */
export function landscapeSectorsOf(snapshot: WorldSnapshot): LandscapeSectors {
  return indexesOf(snapshot).get(LANDSCAPE_SECTORS);
}

/** A map placement that is no sim entity, at half-cell node `(hx, hy)`. */
export interface SceneryObject {
  /** Unique among the scenery: the placement's ordinal. */
  readonly id: number;
  /** Its `[GfxLandscape]` record index. */
  readonly record: number;
  readonly hx: number;
  readonly hy: number;
}

/** Bucket the map's scenery once, keeping only the objects `keep` accepts (the ones with a sound). */
export function scenerySectors(
  objects: Iterable<SceneryObject>,
  keep: (record: number) => boolean,
): LandscapeSectors {
  const sectors = new LandscapeSectors();
  for (const o of objects) {
    if (!keep(o.record)) continue;
    const p = positionOfNode(o.hx, o.hy);
    sectors.add(o.id, o.record, { col: p.x / ONE, row: p.y / ONE });
  }
  return sectors;
}
