import { type Vfs, vjoin } from '@open-northland/vfs';
import { decodeBmd } from '../../decoders/bmd/index.js';
import { errorMessage } from '../../errors.js';
import { MOD_BOBS_DIR, type SourceRoots } from '../../roots.js';
import { emitIndexedAndPreviewAtlas, writeJsonFile } from '../content-tree.js';
import { identityPalette, writeLutPng } from '../palette-lut.js';
import { readSourceFile } from '../source-files.js';
import { buildGoodIcons, GOODS_ATLAS_STEM, type GoodIcon, loadGoods } from './icons.js';
import { loadGoodNames } from './names.js';
import { loadGoodsPalette, loadPaletteAliases } from './palettes.js';

export type { GoodIcon } from './icons.js';
export { resolveGoodIcons } from './icons.js';
export { resolveGoodNames } from './names.js';

/**
 * Goods-icon extraction. A good's icon is its on-map pile graphic: the engine shares one monochrome bob
 * sheet and recolours it per good through a `goods_*`/landscape palette, so a good maps to a (frame,
 * palette) pair rather than a pre-rendered bitmap. Taking the state-1 pile frame as the storehouse icon is
 * observed from the original 1024×768 storehouse, not an extracted lookup.
 */

/** The shared good-pile bob sheet (155 bobs, up to 5 growth states per good). */
const GOODS_BMD = vjoin(MOD_BOBS_DIR, 'ls_goods.bmd');

/** `loadLayer` stem of the emitted recolourable indexed goods atlas. */
const GOODS_INDEXED_STEM = `${GOODS_ATLAS_STEM}.indexed`;
/** Stem of the emitted `256 × N` goods palette LUT PNG under `/bobs/`. */
const GOODS_PALETTE_LUT_STEM = 'goods-palettes-lut';
/** The `content/goods/` subtree, served at `/goods/`. */
const GOODS_CONTENT_DIR = 'goods';
/** The palette the RGBA preview atlas is coloured through; any real goods palette works. */
const PREVIEW_PALETTE = 'goods_wood';
/** The neutral palette the app's iconless-good fallback recolours through, pinned into the LUT so its row
 *  exists even when no bound good references it. */
const GENERIC_ICON_PALETTE = 'goods01';

/** The emitted `goods/manifest.json`. */
export interface GoodsManifest {
  readonly indexedStem: string;
  readonly previewStem: string;
  readonly paletteLutStem: string;
  /** Palette LUT row order (row index = array index) - the app maps a {@link GoodIcon.palette} to its row. */
  readonly palettes: string[];
  /** good string id → its icon binding. */
  readonly icons: Record<string, GoodIcon>;
  /**
   * Localized display names: locale code → (good string id → name). A locale whose string file is missing
   * is simply absent, and the app falls back to the next locale, then the machine id.
   */
  readonly names: Record<string, Record<string, string>>;
}

export interface GoodsStageSummary {
  readonly frames: number;
  readonly palettes: number;
  readonly icons: number;
}

/**
 * Decode `ls_goods.bmd` into an indexed + preview atlas, stack the referenced recolor palettes into a LUT,
 * build the good→icon bindings, and write them under `outDir`.
 */
export async function convertGoodsStage(
  fs: Vfs,
  roots: SourceRoots,
  outDir: string,
): Promise<GoodsStageSummary> {
  let icons: Record<string, GoodIcon>;
  let names: Record<string, Record<string, string>>;
  try {
    const goods = await loadGoods(fs, roots);
    icons = await buildGoodIcons(fs, roots, goods);
    names = await loadGoodNames(fs, roots, goods);
  } catch (err) {
    console.warn(`[pipeline] goods: skipped (good tables unreadable): ${errorMessage(err)}`);
    icons = {};
    names = {};
  }

  const paletteAliases = await loadPaletteAliases(fs, roots);

  // Sorted so the LUT row order is stable across runs.
  const paletteNames = [
    ...new Set([...Object.values(icons).map((i) => i.palette), PREVIEW_PALETTE, GENERIC_ICON_PALETTE]),
  ].sort();
  const paletteByName = new Map<string, Uint8Array>();
  const ordered: Uint8Array[] = [];
  for (const name of paletteNames) {
    let palette = await loadGoodsPalette(fs, roots, name, paletteAliases);
    if (palette === undefined) {
      console.warn(`[pipeline] goods: palette "${name}" unavailable; using neutral row`);
      palette = identityPalette();
    }
    paletteByName.set(name, palette);
    ordered.push(palette);
  }

  let frames = 0;
  try {
    const bmd = decodeBmd(await readSourceFile(fs, roots, GOODS_BMD));
    const emitted = await emitIndexedAndPreviewAtlas(
      fs,
      outDir,
      GOODS_ATLAS_STEM,
      bmd,
      PREVIEW_PALETTE,
      paletteByName.get(PREVIEW_PALETTE) ?? identityPalette(),
    );
    frames = emitted.frames;
  } catch (err) {
    console.warn(`[pipeline] goods: atlas skipped (${GOODS_BMD} unreadable): ${errorMessage(err)}`);
  }

  await writeLutPng(fs, outDir, GOODS_PALETTE_LUT_STEM, ordered);

  const manifest: GoodsManifest = {
    indexedStem: GOODS_INDEXED_STEM,
    previewStem: `${GOODS_ATLAS_STEM}.${PREVIEW_PALETTE}`,
    paletteLutStem: GOODS_PALETTE_LUT_STEM,
    palettes: paletteNames,
    icons,
    names,
  };
  await writeJsonFile(fs, outDir, vjoin(GOODS_CONTENT_DIR, 'manifest.json'), manifest);

  return { frames, palettes: paletteNames.length, icons: Object.keys(icons).length };
}
