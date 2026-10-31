import { WONDER_TRIBE } from '../../catalog/wonders.js';
import { canonicalBuildingRow, perTypeHouseRows, VIKING_TRIBE } from '../../content/building-gfx/index.js';
import { landscapeOverlayRefs } from '../../content/building-gfx/landscape-overlays.js';
import { servedAtlasStem } from '../../content/ir/joins.js';
import type { BuildingBobRow, ContentIr } from '../../content/ir/rows.js';

/** One bob of a composed still, at `(x, y)` from the picture's anchor. */
export interface PictureLayer {
  readonly stem: string;
  readonly bob: number;
  readonly x: number;
  readonly y: number;
}

function layersOf(ir: ContentIr | null, owner: number, row: BuildingBobRow): readonly PictureLayer[] | null {
  const stem = servedAtlasStem(row);
  if (stem === undefined) return null;
  const parts = landscapeOverlayRefs(ir, owner, row.editName)[row.typeId]?.[row.level] ?? [];
  return [
    { stem, bob: row.bobId, x: 0, y: 0 },
    ...parts.flatMap((part) => {
      const [bob] = part.frames;
      return bob === undefined ? [] : [{ stem: part.layer, bob, x: part.x, y: part.y }];
    }),
  ];
}

/**
 * A building's finished picture: its highest level's body (a wonder's lower rows are its scaffold stages,
 * the Colossus's a plank, Zeus a pair of legs) with every landscape part that level's record names, as a
 * wonder stands finished on the map. Of two views of one level the fuller wins: the Gardens' oblique record
 * names its plants by a name no landscape record carries, and the frontal one keeps them. A type its tribe
 * does not draw takes the base tribe's look, then that of the tribe that draws it. Null when no record
 * draws it.
 */
export function buildingPicture(
  ir: ContentIr,
  typeId: number,
  tribe: number,
): readonly PictureLayer[] | null {
  const houses = perTypeHouseRows(ir);
  const rows = houses?.buildingBobs ?? [];
  for (const owner of [tribe, VIKING_TRIBE, WONDER_TRIBE]) {
    const row = canonicalBuildingRow(rows, owner, typeId);
    if (row === undefined) continue;
    const views = rows.filter(
      (other) =>
        other.tribeId === owner &&
        other.typeId === typeId &&
        other.level === row.level &&
        other.editName !== row.editName,
    );
    let fullest = layersOf(houses, owner, row);
    for (const view of views) {
      const layers = layersOf(houses, owner, view);
      if (layers !== null && layers.length > (fullest?.length ?? 0)) fullest = layers;
    }
    if (fullest !== null) return fullest;
  }
  return null;
}
