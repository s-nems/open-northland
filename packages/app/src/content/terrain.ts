import {
  type CellTexture,
  type GroundPattern,
  loadAtlasSource,
  patternSrcRect,
  type TerrainTextureSet,
  type TransitionPattern,
} from '@vinland/render';
import { type ContentIr, loadIr } from './ir.js';

/**
 * The real-ground binding: draw the terrain from REAL decoded `text_*.pcx` textures instead of the
 * flat `TILE_COLOURS` tint. Two levels of fidelity, both served from the gitignored `content/` over
 * the dev/shot vite server (the `/ir.json` + `/textures/` routes — no copyrighted bytes in the repo):
 *
 *  - **1:1 per-triangle** (a decoded original map): the map's `ground` lanes carry the exact
 *    `GfxPattern` choice per cell triangle (the editor bakes its pattern algorithm's output into
 *    `map.dat`); {@link TerrainTextureSet.groundFor} joins each pattern `EditName` onto the full
 *    927-record `gfxPatterns` IR table for its page + UV triangles, and
 *    {@link TerrainTextureSet.transitionFor} joins the map's `transitions.types` names onto the
 *    `gfxPatternTransitions` table (the composed `<stem>.masked.png` RGBA overlay pages).
 *  - **approximated per-typeId** (synthetic grids / maps without ground lanes): the
 *    `terrainPatterns` table binds each landscape typeId to one representative pattern
 *    (`buildTerrainPatterns` — a recorded deviation, source basis).
 *
 * All ground pages load LINEAR-filtered — the original samples its terrain pages bilinearly
 * (docs/SOURCES.md "terrain tessellation"), which melts pattern joins and transition masks into
 * smooth seams; the sprite atlases stay `nearest` (pixel art).
 */

type LoadedSource = Awaited<ReturnType<typeof loadAtlasSource>>;

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
 * the IR is missing (an environment precondition, not a recoverable failure); the shared memoized
 * {@link loadIr} means the (multi-MB) fetch is paid once per page regardless of who reads it first.
 */
export async function loadRealTerrain(ir?: ContentIr): Promise<TerrainTextureSet> {
  const tables = ir ?? (await loadIr());
  if (tables === null) {
    throw new Error(
      'terrain: content/ir.json not found. Run `npm run pipeline` against an owned game copy to populate content/.',
    );
  }
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
  // The transition-overlay join: every well-formed `[transition]` record by name. The page is the
  // pipeline's composed RGBA `<texture stem>.masked.png` (RGB page + alpha mask in one picture) —
  // the plain `<stem>.png` twin lacks the mask, so it is never referenced here.
  const transitionByName = new Map<string, TransitionPattern>();
  for (const row of tables.gfxPatternTransitions ?? []) {
    if (row.editName === undefined || row.texture === undefined || row.coordsA.length === 0) continue;
    const pageKey = `${pageKeyOf(row.texture)}.masked`;
    pageKeys.add(pageKey);
    transitionByName.set(row.editName, { pageKey, coordsA: row.coordsA, coordsB: row.coordsB });
  }
  // Load the distinct pages any table references (~56 + ~19 overlays on the real data), in parallel
  // like loadHumanSpriteSheet's layers. LINEAR-filtered (see the module doc). A page that fails to
  // load is skipped (warn once): the renderer falls back per triangle / skips that overlay — e.g. a
  // `content/` generated before the masked-overlay stage existed still draws its base ground.
  const pages = new Map<string, LoadedSource>();
  await Promise.all(
    [...pageKeys].map(async (key) => {
      try {
        pages.set(key, await loadAtlasSource(`/textures/${key}.png`, 'linear'));
      } catch {
        console.warn(`terrain: page ${key}.png failed to load; its triangles fall back`);
      }
    }),
  );
  return {
    pages,
    cellFor: (typeId) => cellByType.get(typeId),
    groundFor: (name) => patternByName.get(name),
    transitionFor: (name) => transitionByName.get(name),
  };
}
