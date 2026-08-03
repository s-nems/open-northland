import {
  type AtlasFrame,
  PalettedSprite,
  type SpriteLayer,
  type TextureSource,
} from '@open-northland/render';
import { loadLayer } from './ir/load.js';
import { fetchJsonOrNull, loadTextureIfPresent } from './net.js';

/**
 * Goods-icon content bindings for the pipeline's `goods` stage. A good's HUD icon is its on-map pile
 * graphic: the engine shares one monochrome `ls_goods.bmd` sheet recoloured through a `goods_*` palette,
 * so a good maps to (atlas frame, palette row), not a unique bitmap. The binding is keyed by the good's
 * string id, stable across the sandbox and the extracted IR, which number goods differently. A checkout
 * without `content/` yields `null` and consumers draw their text row without an icon.
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
  /** Localized display names: locale → good id → name. */
  readonly names: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** The loaded goods-icon bundle: the indexed `ls_goods` atlas + its palette LUT + the good→icon bindings. */
export interface GoodsArt {
  readonly layer: SpriteLayer;
  readonly lut: TextureSource;
  /** LUT row count (its pixel height) - passed to each {@link PalettedSprite}. */
  readonly colours: number;
  /** The recolor-palette LUT row for a palette name (from the manifest order); row 0 for an unknown name. */
  paletteRow(name: string): number;
  /** The icon binding for a good string id, or `undefined` when the good has no on-map pile graphic. */
  icon(goodId: string): GoodIcon | undefined;
}

const GOODS_MANIFEST_URL = '/goods/manifest.json';

let goodsManifestOnce: Promise<GoodsManifest | null> | null = null;

/** Fetch and parse `content/goods/manifest.json` once per page. `null` when the goods stage hasn't run. */
export function loadGoodsManifest(): Promise<GoodsManifest | null> {
  goodsManifestOnce ??= fetchJsonOrNull<GoodsManifest>(GOODS_MANIFEST_URL);
  return goodsManifestOnce;
}

let goodsArtOnce: Promise<GoodsArt | null> | null = null;

/**
 * The goods manifest, indexed atlas and palette LUT, or `null` when any part is missing. Memoized per
 * page, so every HUD surface that shows a good icon shares one atlas texture.
 */
export function loadGoodsArt(): Promise<GoodsArt | null> {
  goodsArtOnce ??= (async () => {
    const manifest = await loadGoodsManifest();
    if (manifest === null) return null;
    const [layer, lut] = await Promise.all([
      loadLayer(manifest.indexedStem).catch<SpriteLayer | null>(() => null),
      loadTextureIfPresent(`/bobs/${manifest.paletteLutStem}.png`).then((t) => t ?? null),
    ]);
    if (layer === null || lut === null) return null;
    const rowByName = new Map(manifest.palettes.map((name, i) => [name, i] as const));
    return {
      layer,
      lut,
      colours: lut.pixelHeight,
      paletteRow: (name) => rowByName.get(name) ?? 0,
      icon: (goodId) => manifest.icons[goodId],
    };
  })();
  return goodsArtOnce;
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
 * Just the good→icon bindings, the lightweight twin of {@link loadGoodsArt} with no atlas or LUT
 * textures. `null` when the goods stage hasn't run. Memoized.
 */
export function loadGoodsIconManifest(): Promise<GoodIconMap | null> {
  goodsIconManifestOnce ??= (async () => {
    const manifest = await loadGoodsManifest();
    if (manifest === null) return null;
    return new Map(Object.entries(manifest.icons));
  })();
  return goodsIconManifestOnce;
}

/** One built good-icon sprite plus its atlas frame (callers centre/size by the frame's geometry). */
export interface GoodSprite {
  readonly sprite: PalettedSprite;
  readonly frame: AtlasFrame;
}

/**
 * Build a {@link PalettedSprite} for one good icon, or `null` when the frame isn't in the atlas.
 * `colorKey` is `'off'`: the bob mask already cuts the transparent background, and a near-black key would
 * eat the pile art's own dark pixels.
 */
export function makeGoodSprite(art: GoodsArt, icon: GoodIcon): GoodSprite | null {
  const frame = art.layer.atlas.frames.get(icon.frame);
  if (frame === undefined) return null;
  const sprite = new PalettedSprite(art.lut, art.colours);
  sprite.setFrame(art.layer.source, frame, art.layer.atlas.width, art.layer.atlas.height);
  sprite.player = art.paletteRow(icon.palette);
  sprite.colorKey = 'off';
  return { sprite, frame };
}
