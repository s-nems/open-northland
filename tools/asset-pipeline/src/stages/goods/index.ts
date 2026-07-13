import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeBmd } from '../../decoders/bmd/index.js';
import {
  BOBS_DIR,
  emitIndexedAndPreviewAtlas,
  identityPalette,
  readGameFile,
  writeLutPng,
} from '../game-file.js';
import { buildGoodIcons, GOODS_ATLAS_STEM, type GoodIcon, loadGoods } from './icons.js';
import { loadGoodNames } from './names.js';
import { loadGoodsPalette, loadPaletteAliases } from './palettes.js';

export type { GoodIcon } from './icons.js';
export { resolveGoodIcons } from './icons.js';
export { resolveGoodNames } from './names.js';

/**
 * GOODS-ICON extraction stage — the per-good resource icons the HUD draws (storehouse rows, the carry
 * indicator, anywhere a good is named with its glyph). Unlike the tool-panel/order-icon art (that lives in
 * `ls_gui_window.bmd`, handled by the GUI stage), a good's icon is its ON-MAP PILE graphic: the engine
 * shares one monochrome bob sheet — `Data/engine2d/bin/bobs/ls_goods.bmd` (155 bobs, 5 growth states per
 * good) — and recolours it per good through a `goods_*`/landscape `.pcx` palette. So a good maps to a
 * (frame index, recolor palette), not to a unique pre-rendered bitmap. It reuses the same machinery as the
 * GUI stage:
 *
 *  - **Atlas art.** `ls_goods.bmd` becomes (a) an **indexed** atlas (`packIndexedBobAtlas` — palette index
 *    in red, mask in alpha) the app colours per good at draw time through the goods palette LUT, plus (b) an
 *    **RGBA preview** atlas (one default palette) so a human can eyeball it. Both ride the `/bobs/` route.
 *  - **Palettes.** The distinct `goods_*` recolor palettes the good-pile records reference are stacked into
 *    one `256 × N` LUT PNG ({@link writeLutPng}, as the player/GUI LUTs). Row order is emitted in the
 *    manifest (`palettes`), so the app resolves palette-name → row from data rather than a hardcoded mirror.
 *  - **Binding.** `goodtypes.ini` (good `landscapeType`) joined onto the `[GfxLandscape]` "good pile" records
 *    (`editGroups` ∋ `"good piles all"`, matched by `logicType`) yields, per good, the state-1 store-icon bob
 *    (`frame`) + ALL growth-state bobs fewest→most (`fillFrames`, the on-map heap grows through them) + its
 *    palette — emitted as `icons: { goodStringId → {frame, palette, fillFrames} }`, keyed by the good's STRING
 *    id (stable across the sandbox and the extracted IR, which number goods differently).
 *
 * Source basis: the atlas + palettes are decoded original data; the state-1-pile-frame = store-icon choice
 * is observed from the original 1024×768 storehouse (its row icons are each good's smallest pile — a single
 * stone, a small wheat sheaf), not a code-pinned lookup (OpenVikings has no good→icon table). A good binds to
 * its dedicated `good piles all` pile record when it has one (tools/weapons/crockery/armour/food all do),
 * else falls back to its broader `goods all` item record — `fruit`, the six potions (bottles), and the six
 * amulets (rings) have only that, so the fallback binds them instead of leaving them iconless: the
 * potions/amulets recover their own dedicated bottle/ring graphic (recoloured per type), while `fruit`'s
 * `goods all` record reuses BREAD's frames in the source (no distinct fruit art exists). Only the goods sharing
 * `landscapeType 1` with no record at all (prey, sheep, cattle, hand/ox carts, ships, catapult, chest) stay
 * unbound and render iconless.
 *
 * Boundary failures are warned-and-skipped, never fatal (matching the other stages). No copyrighted bytes
 * enter the repo — everything lands under the gitignored `content/`.
 *
 * The good→icon and good→name join rules live in {@link ./icons} / {@link ./names} (pure, unit-tested);
 * recolour-palette resolution in {@link ./palettes}. This module orchestrates them + the atlas/LUT emit.
 */

/** `Data/engine2d/bin/bobs/ls_goods.bmd` — the shared good-pile bob sheet (155 bobs, 5 states per good). */
const GOODS_BMD = join(BOBS_DIR, 'ls_goods.bmd');

/** `loadLayer` stem of the emitted indexed goods atlas (the recolourable `ls_goods.indexed`). */
const GOODS_INDEXED_STEM = `${GOODS_ATLAS_STEM}.indexed`;
/** `loadLayer`/`loadAtlasSource` stem of the emitted `256 × N` goods palette LUT PNG (under `/bobs/`). */
const GOODS_PALETTE_LUT_STEM = 'goods-palettes-lut';
/** The `content/goods/` subtree the manifest is written to (served at `/goods/`). */
const GOODS_CONTENT_DIR = 'goods';
/** The palette the human-readable RGBA preview atlas is coloured through (any real goods palette). */
const PREVIEW_PALETTE = 'goods_wood';
/** The neutral palette the app's GENERIC_GOOD_ICON fallback recolours through — pinned into the LUT so an
 *  iconless good always has a valid row, even if no bound good happens to reference it. */
const GENERIC_ICON_PALETTE = 'goods01';

/** The emitted `goods/manifest.json`: the app's contract for loading + binding good icons. */
export interface GoodsManifest {
  readonly indexedStem: string;
  readonly previewStem: string;
  readonly paletteLutStem: string;
  /** Palette LUT row order (row index = array index) — the app maps a {@link GoodIcon.palette} to its row. */
  readonly palettes: string[];
  /** good STRING id → its icon binding. */
  readonly icons: Record<string, GoodIcon>;
  /**
   * Localized DISPLAY names: locale code → (good STRING id → name), extracted from the game's own
   * `text/<lang>/strings/gameobjects/goods.{ini,cif}` string tables. The app resolves a good's shown name
   * through this with a locale fallback chain, so the whole catalog reads in the player's language and
   * adding a language is a data edit, not code. A locale whose string file is missing is simply absent
   * (the app falls back to the next locale, then the machine id).
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
 * build the good→icon bindings, and write them under `outDir`. Warns-and-returns-empty if the atlas or good
 * tables are unreadable (a partial install still leaves the rest of the pipeline intact).
 */
export async function convertGoodsStage(gameDir: string, outDir: string): Promise<GoodsStageSummary> {
  let icons: Record<string, GoodIcon>;
  let names: Record<string, Record<string, string>>;
  try {
    icons = await buildGoodIcons(gameDir);
    names = await loadGoodNames(gameDir, await loadGoods(gameDir));
  } catch (err) {
    console.warn(`[pipeline] goods: skipped (good tables unreadable): ${(err as Error).message}`);
    icons = {};
    names = {};
  }

  // The name→.pcx alias graph (palettes.ini), so a palette editname resolves to its real file — the same
  // resolution the bmd stage uses, without which the aliased landscape palettes render white in the HUD.
  const paletteAliases = await loadPaletteAliases(gameDir);

  // The distinct recolor palettes the icons reference, in a deterministic (sorted) LUT row order. Include
  // the preview palette so the same LUT can colour the preview atlas if a consumer ever wants it.
  const paletteNames = [
    ...new Set([...Object.values(icons).map((i) => i.palette), PREVIEW_PALETTE, GENERIC_ICON_PALETTE]),
  ].sort();
  const paletteByName = new Map<string, Uint8Array>();
  const ordered: Uint8Array[] = [];
  for (const name of paletteNames) {
    let palette = await loadGoodsPalette(gameDir, name, paletteAliases);
    if (palette === undefined) {
      console.warn(`[pipeline] goods: palette "${name}" unavailable; using neutral row`);
      palette = identityPalette();
    }
    paletteByName.set(name, palette);
    ordered.push(palette);
  }

  let frames = 0;
  try {
    const bmd = decodeBmd(await readGameFile(gameDir, GOODS_BMD));
    const emitted = await emitIndexedAndPreviewAtlas(
      outDir,
      GOODS_ATLAS_STEM,
      bmd,
      PREVIEW_PALETTE,
      paletteByName.get(PREVIEW_PALETTE) ?? identityPalette(),
    );
    frames = emitted.frames;
  } catch (err) {
    console.warn(`[pipeline] goods: atlas skipped (${GOODS_BMD} unreadable): ${(err as Error).message}`);
  }

  await writeLutPng(outDir, GOODS_PALETTE_LUT_STEM, ordered);

  const manifest: GoodsManifest = {
    indexedStem: GOODS_INDEXED_STEM,
    previewStem: `${GOODS_ATLAS_STEM}.${PREVIEW_PALETTE}`,
    paletteLutStem: GOODS_PALETTE_LUT_STEM,
    palettes: paletteNames,
    icons,
    names,
  };
  await mkdir(join(outDir, GOODS_CONTENT_DIR), { recursive: true });
  await writeFile(join(outDir, GOODS_CONTENT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  return { frames, palettes: paletteNames.length, icons: Object.keys(icons).length };
}
