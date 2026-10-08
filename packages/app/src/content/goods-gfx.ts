import { fetchJsonOrNull } from './net.js';

/**
 * Goods-icon content bindings for the pipeline's `goods` stage. A good's HUD icon is its on-map pile
 * graphic: the engine shares one monochrome `ls_goods.bmd` sheet recoloured through one of the goods-LUT
 * palettes, so a good maps to (atlas frame, palette row), not a unique bitmap. The binding is keyed by the
 * good's string id, stable across the sandbox and the extracted IR, which number goods differently. A
 * checkout without `content/` yields `null` and consumers draw their text row without an icon.
 */

/** One good's icon binding as it ships in `content/goods/manifest.json`. */
export interface GoodIcon {
  /** `ls_goods` atlas frame index (bob id) - the good's state-1 pile graphic (the compact store icon). */
  readonly frame: number;
  /** The recolor palette name (a goods-LUT row, resolved via the manifest order). */
  readonly palette: string;
  /** The pile's growth-state bobs ordered fewest→most units (state 1 → N; up to 5). The on-map dropped
   *  heap indexes these by its fill so it grows with its contents; `frame` is `fillFrames[0]` (state 1). */
  readonly fillFrames: readonly number[];
}

/** The emitted `goods/manifest.json` shape (mirrors the pipeline's `GoodsManifest`). */
export interface GoodsManifest {
  readonly indexedStem: string;
  readonly previewStem: string;
  readonly paletteLutStem: string;
  readonly palettes: readonly string[];
  readonly icons: Readonly<Record<string, GoodIcon>>;
}

const GOODS_MANIFEST_URL = '/goods/manifest.json';

let goodsManifestOnce: Promise<GoodsManifest | null> | null = null;

/** Fetch and parse `content/goods/manifest.json` once per page. `null` when the goods stage hasn't run. */
export function loadGoodsManifest(): Promise<GoodsManifest | null> {
  goodsManifestOnce ??= fetchJsonOrNull<GoodsManifest>(GOODS_MANIFEST_URL);
  return goodsManifestOnce;
}

/** The good string id → icon binding map, as the manifest ships it (frame and palette data, no textures). */
export type GoodIconMap = ReadonlyMap<string, GoodIcon>;

/**
 * The neutral generic icon for a good with no `ls_goods` art: the state-1 heap bob recoloured through the
 * neutral `goods01` palette, which is always a valid LUT/atlas row. A named approximation shared by the
 * HUD icon and the in-world dropped pile, so an iconless good reads the same in both places.
 */
export const GENERIC_GOOD_ICON: GoodIcon = { frame: 0, palette: 'goods01', fillFrames: [0] };

let goodsIconManifestOnce: Promise<GoodIconMap | null> | null = null;

/**
 * Just the good→icon bindings, with no atlas or LUT textures. `null` when the goods stage hasn't run. Memoized.
 */
export function loadGoodsIconManifest(): Promise<GoodIconMap | null> {
  goodsIconManifestOnce ??= (async () => {
    const manifest = await loadGoodsManifest();
    if (manifest === null) return null;
    return new Map(Object.entries(manifest.icons));
  })();
  return goodsIconManifestOnce;
}
