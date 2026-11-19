import { ADDED_HOUSE_PALETTES } from '../../catalog/building-tweaks.js';
import type { ContentIr } from '../ir/rows.js';

interface PalettedHouseRow {
  readonly tribeId: number;
  readonly typeId: number;
  readonly paletteName: string;
}

const typeKey = (tribeId: number, typeId: number): string => `${tribeId}:${typeId}`;

const ADDED_BY_TYPE: ReadonlyMap<string, readonly string[]> = new Map(
  ADDED_HOUSE_PALETTES.map(({ tribeId, typeId, palettes }) => [typeKey(tribeId, typeId), palettes]),
);

/** A lane with each named type's first-palette rows copied once per added palette it does not list. */
function withAddedPalettes<T extends PalettedHouseRow>(rows: readonly T[]): readonly T[] {
  const listed = new Map<string, string[]>();
  for (const row of rows) {
    const key = typeKey(row.tribeId, row.typeId);
    if (!ADDED_BY_TYPE.has(key)) continue;
    const palettes = listed.get(key);
    if (palettes === undefined) listed.set(key, [row.paletteName]);
    else if (!palettes.includes(row.paletteName)) palettes.push(row.paletteName);
  }
  if (listed.size === 0) return rows;
  const added: T[] = [];
  for (const row of rows) {
    const key = typeKey(row.tribeId, row.typeId);
    const palettes = listed.get(key);
    if (palettes === undefined || palettes[0] !== row.paletteName) continue;
    for (const paletteName of ADDED_BY_TYPE.get(key) ?? []) {
      if (!palettes.includes(paletteName)) added.push({ ...row, paletteName });
    }
  }
  return [...rows, ...added];
}

/** The IR with {@link ADDED_HOUSE_PALETTES} in every paletted `[GfxHouse]` lane: bodies, construction
 *  stages, state overlays and doors, so a building's skin slot draws them all in the same palette. */
export function withAddedHousePalettes(ir: ContentIr): ContentIr {
  const { buildingBobs, constructionLayers, buildingOverlays, buildingDoors } = ir;
  return {
    ...ir,
    ...(buildingBobs !== undefined ? { buildingBobs: withAddedPalettes(buildingBobs) } : {}),
    ...(constructionLayers !== undefined
      ? { constructionLayers: withAddedPalettes(constructionLayers) }
      : {}),
    ...(buildingOverlays !== undefined ? { buildingOverlays: withAddedPalettes(buildingOverlays) } : {}),
    ...(buildingDoors !== undefined ? { buildingDoors: withAddedPalettes(buildingDoors) } : {}),
  };
}
