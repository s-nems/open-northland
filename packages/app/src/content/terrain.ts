import {
  type CellTexture,
  type GroundPattern,
  type TerrainTextureSet,
  loadAtlasSource,
  patternSrcRect,
} from '@vinland/render';

/**
 * The real-ground binding: draw the terrain from REAL decoded `text_*.pcx` textures instead of the
 * flat `TILE_COLOURS` tint. Two levels of fidelity, both served from the gitignored `content/` over
 * the dev/shot vite server (the `/ir.json` + `/textures/` routes — no copyrighted bytes in the repo):
 *
 *  - **1:1 per-triangle** (a decoded original map): the map's `ground` lanes carry the exact
 *    `GfxPattern` choice per cell triangle (the editor bakes its pattern algorithm's output into
 *    `map.dat`); {@link TerrainTextureSet.groundFor} joins each pattern `EditName` onto the full
 *    927-record `gfxPatterns` IR table for its page + UV triangles. Coastlines/transition blocks
 *    join up exactly like the original.
 *  - **approximated per-typeId** (synthetic grids / maps without ground lanes): the
 *    `terrainPatterns` table binds each landscape typeId to one representative pattern
 *    (`buildTerrainPatterns` — a recorded deviation, docs/FIDELITY.md).
 */

/** One `TerrainPattern` row as it ships in `content/ir.json` (the fields the render binding needs). */
interface TerrainPatternRow {
  readonly typeId: number;
  readonly texture: string;
  readonly coordsA: number[];
  readonly coordsB: number[];
  readonly debugColor?: [number, number, number];
}

/** One `GfxPattern` row as it ships in `content/ir.json` (the 1:1 per-triangle join fields). */
interface GfxPatternRow {
  readonly editName?: string;
  readonly texture?: string;
  readonly coordsA?: number[];
  readonly coordsB?: number[];
}

/** The slice of `content/ir.json` the terrain + map-object bindings read. The four trailing row
 *  views feed the authored-entity joins (`resolveAuthoredPlacements` — a `map.cif` building/human
 *  name resolves to its sim typeId through these), so a map with `entities` needs no second fetch. */
export interface TerrainIr {
  readonly terrainPatterns?: TerrainPatternRow[];
  readonly gfxPatterns?: GfxPatternRow[];
  readonly landscapeGfx?: LandscapeGfxRow[];
  readonly buildingBobs?: { editName?: string; level?: number; typeId?: number; tribeId?: number }[];
  readonly buildings?: { typeId?: number; id?: string; kind?: string }[];
  readonly jobs?: { typeId?: number; id?: string; name?: string }[];
  readonly tribes?: { typeId?: number; id?: string }[];
}

/** One `LandscapeGfx` row as it ships in `content/ir.json` (the map-object binding fields). */
export interface LandscapeGfxRow {
  readonly editName?: string;
  readonly bmd?: string;
  readonly paletteName?: string;
  readonly frames?: { state: number; bobIds: number[] }[];
  readonly isStatic?: boolean;
  readonly loopAnimation?: boolean;
  readonly dynamicBackground?: boolean;
  readonly walkBlockAreas?: number[][];
}

type LoadedSource = Awaited<ReturnType<typeof loadAtlasSource>>;

/**
 * Fetch the served `content/ir.json` once for the terrain + map-object bindings. Throws a pointed
 * error if the IR is missing (the pipeline hasn't been run) — an environment precondition the caller
 * turns into its graceful fallback.
 */
export async function fetchTerrainIr(): Promise<TerrainIr> {
  const res = await fetch('/ir.json');
  if (!res.ok) {
    throw new Error(
      `terrain: content/ir.json not found (HTTP ${res.status}). Run \`npm run pipeline\` against an owned game copy to populate content/.`,
    );
  }
  return (await res.json()) as TerrainIr;
}

/** Texture page key from a `data/.../text_NNN.pcx` path: the basename without its extension (`text_NNN`). */
function pageKeyOf(texture: string): string {
  const base = texture.split('/').pop() ?? texture;
  return base.replace(/\.[^.]+$/, '');
}

/** Pack an `[r, g, b]` debug colour into a `0xRRGGBB` int for the flat-tint fallback; `undefined` passes through. */
function rgbToHex(rgb: readonly [number, number, number] | undefined): number | undefined {
  if (rgb === undefined) return undefined;
  return ((rgb[0] & 0xff) << 16) | ((rgb[1] & 0xff) << 8) | (rgb[2] & 0xff);
}

/**
 * Load the real {@link TerrainTextureSet}: the approximated per-typeId {@link CellTexture} table
 * (from `terrainPatterns`) PLUS the 1:1 per-triangle pattern join (from the full `gfxPatterns`
 * table, keyed by `EditName`), then every referenced `text_NNN.png` page as a GPU source. Throws if
 * the IR is missing (an environment precondition, not a recoverable failure); pass a pre-fetched
 * `ir` to share the (multi-MB) fetch with the map-object loader.
 */
export async function loadRealTerrain(ir?: TerrainIr): Promise<TerrainTextureSet> {
  const tables = ir ?? (await fetchTerrainIr());
  const rows = tables.terrainPatterns ?? [];
  const cellByType = new Map<number, CellTexture>();
  const pageKeys = new Set<string>();
  for (const row of rows) {
    const pageKey = pageKeyOf(row.texture);
    pageKeys.add(pageKey);
    const fallbackColour = rgbToHex(row.debugColor);
    // Spread the optional colour only when present — `exactOptionalPropertyTypes` rejects an explicit
    // `undefined` on an optional field.
    cellByType.set(row.typeId, {
      pageKey,
      rect: patternSrcRect(row.coordsA, row.coordsB),
      ...(fallbackColour !== undefined ? { fallbackColour } : {}),
    });
  }
  // The 1:1 join: every well-formed GfxPattern by its EditName (unique across the real 927 records).
  const patternByName = new Map<string, GroundPattern>();
  for (const row of tables.gfxPatterns ?? []) {
    if (
      row.editName === undefined ||
      row.texture === undefined ||
      row.coordsA === undefined ||
      row.coordsB === undefined
    ) {
      continue;
    }
    const pageKey = pageKeyOf(row.texture);
    pageKeys.add(pageKey);
    patternByName.set(row.editName, { pageKey, coordsA: row.coordsA, coordsB: row.coordsB });
  }
  // Load the distinct pages either table references (~56 on the real data), in parallel like
  // loadHumanSpriteSheet's layers.
  const pages = new Map<string, LoadedSource>();
  await Promise.all(
    [...pageKeys].map(async (key) => {
      pages.set(key, await loadAtlasSource(`/textures/${key}.png`));
    }),
  );
  return {
    pages,
    cellFor: (typeId) => cellByType.get(typeId),
    groundFor: (name) => patternByName.get(name),
  };
}
