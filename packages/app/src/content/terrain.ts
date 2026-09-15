import {
  type CellTexture,
  type GroundPattern,
  loadAtlasSource,
  patternSrcRect,
  type TerrainTextureSet,
  type TransitionPattern,
  texturePageKey,
} from '@open-northland/render';
import { diag } from '../diag/index.js';
import { loadIr } from './ir/load.js';
import type { ContentIr } from './ir/rows.js';

/**
 * The real-ground binding: draw terrain from the decoded `text_*.pcx` pages served out of the gitignored
 * `content/`. Two levels of fidelity: a decoded original map carries the exact `GfxPattern` per cell
 * triangle and joins it 1:1 by `EditName`, while a synthetic grid falls back to `terrainPatterns`, which
 * binds each landscape typeId to one representative pattern (a recorded deviation).
 *
 * All ground pages load linear-filtered against the original's bilinear terrain sampling. That reading
 * comes from a community renderer used as an oracle, not from byte evidence, so it is an approximation.
 * The sprite atlases stay `nearest`.
 */

type LoadedSource = Awaited<ReturnType<typeof loadAtlasSource>>;

/** Index the decoded ground patterns without loading their texture pages. */
export function buildGroundPatternIndex(tables: ContentIr): ReadonlyMap<string, GroundPattern> {
  const patterns = new Map<string, GroundPattern>();
  for (const row of tables.gfxPatterns ?? []) {
    if (
      row.editName === undefined ||
      row.texture === undefined ||
      row.coordsA === undefined ||
      row.coordsB === undefined
    ) {
      continue;
    }
    patterns.set(row.editName, {
      pageKey: texturePageKey(row.texture),
      coordsA: row.coordsA,
      coordsB: row.coordsB,
    });
  }
  return patterns;
}

/** Pack an `[r, g, b]` debug colour into a `0xRRGGBB` int for the flat-tint fallback; `undefined` passes through. */
function rgbToHex(rgb: readonly [number, number, number] | undefined): number | undefined {
  if (rgb === undefined) return undefined;
  return ((rgb[0] & 0xff) << 16) | ((rgb[1] & 0xff) << 8) | (rgb[2] & 0xff);
}

/** Index the extracted per-terrain debug colours used by flat minimap fallbacks. */
export function buildTerrainDebugColourIndex(tables: ContentIr): ReadonlyMap<number, number> {
  const colours = new Map<number, number>();
  for (const row of tables.terrainPatterns ?? []) {
    const colour = rgbToHex(row.debugColor);
    if (colour !== undefined) colours.set(row.typeId, colour);
  }
  return colours;
}

/**
 * Real terrain content is absent: no served `ir.json`, or not one referenced ground texture page could be
 * loaded. An environment precondition (the pipeline has not populated `content/`), not a decode bug.
 */
export class MissingTerrainError extends Error {}

/**
 * Load the real {@link TerrainTextureSet}: the approximated per-typeId {@link CellTexture} table, the 1:1
 * per-triangle pattern join keyed by `EditName`, then every referenced `text_NNN.png` page as a GPU
 * source. Throws {@link MissingTerrainError} when the environment has no real terrain to serve; pass
 * `ir: null` when the caller already resolved the IR as absent. `loadPage` is injectable so the absence
 * policy is testable without a GPU.
 */
export async function loadRealTerrain(
  ir?: ContentIr | null,
  loadPage: (url: string) => Promise<LoadedSource> = (url) => loadAtlasSource(url, 'linear'),
): Promise<TerrainTextureSet> {
  const tables = ir !== undefined ? ir : await loadIr();
  if (tables === null) {
    throw new MissingTerrainError(
      'terrain: content/ir.json not found. Run `npm run build:content` to populate content/.',
    );
  }
  const rows = tables.terrainPatterns ?? [];
  const cellByType = new Map<number, CellTexture>();
  const debugColours = buildTerrainDebugColourIndex(tables);
  const pageKeys = new Set<string>();
  for (const row of rows) {
    const pageKey = texturePageKey(row.texture);
    pageKeys.add(pageKey);
    const fallbackColour = debugColours.get(row.typeId);
    // `exactOptionalPropertyTypes` rejects an explicit `undefined`, so spread the colour only if present.
    cellByType.set(row.typeId, {
      pageKey,
      rect: patternSrcRect(row.coordsA, row.coordsB),
      ...(fallbackColour !== undefined ? { fallbackColour } : {}),
    });
  }
  // The 1:1 join: every well-formed GfxPattern by its EditName (unique across the real 927 records).
  const patternByName = buildGroundPatternIndex(tables);
  for (const pattern of patternByName.values()) pageKeys.add(pattern.pageKey);
  // A transition draws off the pipeline's composed `<stem>.masked.png` (RGB page and alpha mask in one
  // picture); the plain `<stem>.png` twin lacks the mask, so it is never referenced here.
  const transitionByName = new Map<string, TransitionPattern>();
  for (const row of tables.gfxPatternTransitions ?? []) {
    if (row.editName === undefined || row.texture === undefined || row.coordsA.length === 0) continue;
    const pageKey = `${texturePageKey(row.texture)}.masked`;
    pageKeys.add(pageKey);
    transitionByName.set(row.editName, { pageKey, coordsA: row.coordsA, coordsB: row.coordsB });
  }
  // A page that fails to load is skipped: the renderer falls back per triangle, or skips that overlay.
  const pages = new Map<string, LoadedSource>();
  await Promise.all(
    [...pageKeys].map(async (key) => {
      try {
        pages.set(key, await loadPage(`/textures/${key}.png`));
      } catch {
        diag.warn('content', `terrain: page ${key}.png failed to load; its triangles fall back`);
      }
    }),
  );
  // Zero loaded pages is the missing-content state, not a degradation: a set that flat-tints every
  // triangle must not pass as real terrain.
  if (pages.size === 0) {
    throw new MissingTerrainError(
      'terrain: content/ has no loadable ground texture pages. Run `npm run build:content` to populate content/.',
    );
  }
  return {
    pages,
    cellFor: (typeId) => cellByType.get(typeId),
    groundFor: (name) => patternByName.get(name),
    transitionFor: (name) => transitionByName.get(name),
  };
}
