import { type CellTexture, type TerrainTextureSet, loadAtlasSource, patternSrcRect } from '@vinland/render';

/**
 * The `?terrain` binding: draw the ground from REAL decoded `text_*.pcx` textures instead of the flat
 * `TILE_COLOURS` tint. The visible payoff of the terrain-ground-texture slice (docs/ROADMAP.md Phase 2,
 * steps 2+4) — it puts actual decoded ground pixels under the cells so a person can judge the
 * approximated typeId→pattern placement against the original.
 *
 * Like `?map=`/`?atlas=real`, it loads from the GITIGNORED `content/` over the dev/shot vite server (the
 * `/ir.json` + `/textures/` routes) — no copyrighted bytes enter the repo, and the committed default
 * (no `?terrain`) keeps the flat-tint fallback so tests + the reproducible shot are unaffected.
 *
 * It reads the **approximated** `terrainPatterns` table the pipeline emits (`buildTerrainPatterns`):
 * each landscape typeId → one representative ground pattern (its `text_NNN` page + the tile's UV
 * sub-rect) + the logic-type `debugColor` flat-tint fallback. The renderer batches the cells per page
 * into meshes; this side only fetches the table + the pages it references.
 */

/** One `TerrainPattern` row as it ships in `content/ir.json` (the fields the render binding needs). */
interface TerrainPatternRow {
  readonly typeId: number;
  readonly texture: string;
  readonly coordsA: number[];
  readonly coordsB: number[];
  readonly debugColor?: [number, number, number];
}

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
 * Load the real {@link TerrainTextureSet}: fetch the emitted `terrainPatterns` table from the served
 * `ir.json`, derive a {@link CellTexture} per landscape typeId (page key + UV sub-rect + fallback
 * colour), then load each referenced `text_NNN.png` page as a GPU source. Throws a pointed error if the
 * IR is missing (the pipeline hasn't been run) — an environment precondition, not a recoverable failure.
 */
export async function loadRealTerrain(): Promise<TerrainTextureSet> {
  const res = await fetch('/ir.json');
  if (!res.ok) {
    throw new Error(
      `?terrain: content/ir.json not found (HTTP ${res.status}). Run \`npm run pipeline\` against an owned game copy to populate content/.`,
    );
  }
  const ir = (await res.json()) as { terrainPatterns?: TerrainPatternRow[] };
  const rows = ir.terrainPatterns ?? [];
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
  // Load only the distinct pages the table references (a handful after the per-family approximation),
  // in parallel like loadHumanSpriteSheet's layers.
  const pages = new Map<string, LoadedSource>();
  await Promise.all(
    [...pageKeys].map(async (key) => {
      pages.set(key, await loadAtlasSource(`/textures/${key}.png`));
    }),
  );
  return { pages, cellFor: (typeId) => cellByType.get(typeId) };
}
