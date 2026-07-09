import { type AtlasFrame, PalettedSprite, type SpriteLayer, type TextureSource } from '@vinland/render';
import { loadLayer } from './ir.js';
import { fetchJsonOrNull, loadTextureIfPresent } from './net.js';

/**
 * Goods-icon content bindings — the loadable seam for the pipeline's `goods` stage. A good's HUD icon is
 * its on-map PILE graphic: the engine shares one monochrome sheet (`ls_goods.bmd`) recoloured per good
 * through a `goods_*` palette, so a good maps to (an atlas frame, a palette row), NOT a unique bitmap. This
 * is the goods twin of {@link import('./gui-art.js')}: the indexed atlas is read through the goods palette
 * LUT by a {@link PalettedSprite}, the same mechanism as the player/GUI colours.
 *
 * The binding (good STRING id → {frame, palette}) is keyed by the good's string id, which is stable across
 * the sandbox and the extracted IR (they number goods differently), so one manifest serves every scene.
 * A checkout without `content/` yields `null` and consumers draw their text row without an icon.
 */

/** One good's icon binding as it ships in `content/goods/manifest.json`. */
export interface GoodIcon {
  /** `ls_goods` atlas frame index (bob id) — the good's state-1 pile graphic. */
  readonly frame: number;
  /** The recolor palette name (a goods-LUT row, resolved via the manifest order). */
  readonly palette: string;
}

/** The emitted `goods/manifest.json` shape (mirrors the pipeline's `GoodsManifest`). */
interface GoodsManifest {
  readonly indexedStem: string;
  readonly previewStem: string;
  readonly paletteLutStem: string;
  readonly palettes: readonly string[];
  readonly icons: Readonly<Record<string, GoodIcon>>;
}

/** The loaded goods-icon bundle: the indexed `ls_goods` atlas + its palette LUT + the good→icon bindings. */
export interface GoodsArt {
  readonly layer: SpriteLayer;
  readonly lut: TextureSource;
  /** LUT row count (its pixel height) — passed to each {@link PalettedSprite}. */
  readonly colours: number;
  /** The recolor-palette LUT row for a palette name (from the manifest order); row 0 for an unknown name. */
  paletteRow(name: string): number;
  /** The icon binding for a good STRING id, or `undefined` when the good has no on-map pile graphic. */
  icon(goodId: string): GoodIcon | undefined;
}

const GOODS_MANIFEST_URL = '/goods/manifest.json';

let goodsArtOnce: Promise<GoodsArt | null> | null = null;

/**
 * Load the goods manifest + indexed atlas + palette LUT, or `null` when any half is missing (the goods
 * pipeline stage hasn't run). Memoized per page like {@link import('./gui-art.js').loadGuiArt}: every HUD
 * surface that shows a good icon shares one atlas texture.
 */
export function loadGoodsArt(): Promise<GoodsArt | null> {
  goodsArtOnce ??= (async () => {
    const manifest = await fetchJsonOrNull<GoodsManifest>(GOODS_MANIFEST_URL);
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

/** One built good-icon sprite plus its atlas frame (callers centre/size by the frame's geometry). */
export interface GoodSprite {
  readonly sprite: PalettedSprite;
  readonly frame: AtlasFrame;
}

/**
 * Build a {@link PalettedSprite} for one good icon — the good's `ls_goods` frame recoloured through its
 * palette row — or `null` when the frame isn't in the atlas. `colorKey` is `'off'`: the bob mask (atlas
 * alpha) already cuts the transparent background, and the pile art's own dark pixels must be KEPT (a
 * near-black key would eat them).
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
