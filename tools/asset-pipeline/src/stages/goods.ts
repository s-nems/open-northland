import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { packBobAtlas, packIndexedBobAtlas } from '../decoders/atlas.js';
import { decodeBmd } from '../decoders/bmd.js';
import { decodeCifStringArray } from '../decoders/cif.js';
import {
  cifLinesToSections,
  decodeIni,
  extractGoods,
  extractLandscapeGfx,
  parseIniSections,
} from '../decoders/ini.js';
import { decodePcx } from '../decoders/pcx.js';
import { buildPlayerLutImage } from '../decoders/player-palette.js';
import { encodePng } from '../decoders/png.js';
import { BOBS_DIR, identityPalette, readGameFile, writeBobAtlas } from './game-file.js';

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
 *    one `256 × N` LUT PNG ({@link buildPlayerLutImage}, as the player/GUI LUTs). Row order is emitted in the
 *    manifest (`palettes`), so the app resolves palette-name → row from data rather than a hardcoded mirror.
 *  - **Binding.** `goodtypes.ini` (good `landscapeType`) joined onto the `[GfxLandscape]` "good pile" records
 *    (`editGroups` ∋ `"good piles all"`, matched by `logicType`) yields, per good, the state-1 store-icon bob
 *    (`frame`) + ALL growth-state bobs fewest→most (`fillFrames`, the on-map heap grows through them) + its
 *    palette — emitted as `icons: { goodStringId → {frame, palette, fillFrames} }`, keyed by the good's STRING
 *    id (stable across the sandbox and the extracted IR, which number goods differently).
 *
 * Source basis: the atlas + palettes are decoded original data; the state-1-pile-frame = store-icon choice
 * is observed from the original 1024×768 storehouse (its row icons are each good's smallest pile — a single
 * stone, a small wheat sheaf), not a code-pinned lookup (OpenVikings has no good→icon table). 42 of the 65
 * goods bind (including tools/weapons/crockery/armour — they DO have `ls_goods` pile records). The rest get
 * no binding and render their row iconless: goods whose `landscapeType` has no `good piles all` record —
 * `fruit`, the six potions, the six amulets — and the many goods that share `landscapeType 1` (prey, sheep,
 * cattle, hand/ox carts, ships, catapult, chest), whose one shared type has no pile record. Filling those is
 * a later montage/human pass over `ls_goods`.
 *
 * Boundary failures are warned-and-skipped, never fatal (matching the other stages). No copyrighted bytes
 * enter the repo — everything lands under the gitignored `content/`.
 *
 * Two deliberate choices vs. the pre-existing gathering-render path (`app/content/resource-gfx.ts`, which
 * draws live ground piles from the bmd tree-walk's per-palette baked `ls_goods.<palette>` RGBA atlases via
 * `gatheringPipeline`):
 *  - **Key on `landscapeType`, not the gathering `landscapeToStore`.** The store icon must exist for
 *    produced/stored goods too (water, flour, bread, coin), whose `landscapeToStore` (and thus their
 *    `gatheringPipeline.store` entry) is undefined — keying off it would silently drop their icons. A good's
 *    own `landscapeType` resolves the correct pile record for those, matching the original storehouse rows.
 *  - **Emit ONE indexed atlas + a goods LUT** (recoloured per row by a `PalettedSprite`) rather than reuse
 *    the N per-palette baked RGBA sheets. A storehouse panel shows many goods across many palettes at once;
 *    one indexed atlas + one LUT is a single load for all of them, where the baked RGBA path would need one
 *    sheet per palette. The trade is some overlap with that pile resolution, accepted for the single load.
 */

/** `Data/engine2d/bin/bobs/ls_goods.bmd` — the shared good-pile bob sheet (155 bobs, 5 states per good). */
const GOODS_BMD = join(BOBS_DIR, 'ls_goods.bmd');
/** The plaintext good table (good `name`/`type`/`landscapetype`). */
const GOODTYPES_INI = join('Data', 'logic', 'goodtypes.ini');
/** The `[GfxLandscape]` object table that binds `ls_goods.bmd` frames to goods by `logicType`. */
const LANDSCAPES_CIF = join('Data', 'engine2d', 'inis', 'landscapes', 'landscapes.cif');
/** Where a `goods_*`/landscape recolor palette `.pcx` may live (searched in order). */
const PALETTE_DIRS = [
  join('Data', 'engine2d', 'bin', 'palettes', 'goods'),
  join('Data', 'engine2d', 'bin', 'palettes', 'landscapes'),
];

/** `loadLayer` stem of the recolourable indexed goods atlas (`<stem>.png` + `<stem>.atlas.json`). */
export const GOODS_ATLAS_STEM = 'ls_goods';
export const GOODS_INDEXED_STEM = `${GOODS_ATLAS_STEM}.indexed`;
/** `loadLayer`/`loadAtlasSource` stem of the emitted `256 × N` goods palette LUT PNG (under `/bobs/`). */
export const GOODS_PALETTE_LUT_STEM = 'goods-palettes-lut';
/** The `content/goods/` subtree the manifest is written to (served at `/goods/`). */
const GOODS_CONTENT_DIR = 'goods';
/** The `editGroups` membership marking a `[GfxLandscape]` record as a good's on-map pile graphic. */
const GOOD_PILE_GROUP = 'good piles all';
/** The pile growth state whose frame the storehouse row uses as the compact good icon (smallest unit). */
const ICON_PILE_STATE = 1;
/** The palette the human-readable RGBA preview atlas is coloured through (any real goods palette). */
const PREVIEW_PALETTE = 'goods_wood';

/** One good's icon binding: an `ls_goods` frame + the recolor palette (a goods-LUT row) it draws through. */
export interface GoodIcon {
  /** `ls_goods` atlas frame index (bob id) — the good's state-1 pile graphic (the compact store icon). */
  readonly frame: number;
  /** The recolor palette name (a {@link GoodsManifest.palettes} row). */
  readonly palette: string;
  /**
   * The pile's growth-state bobs ordered FEWEST→MOST units (state 1 → N; an `ls_goods` pile carries up to
   * 5 states). The on-map dropped heap indexes these by its fill amount so the pile visibly grows with its
   * contents; `frame` is `fillFrames[0]` (state 1), the smallest single-unit heap the storehouse row uses.
   */
  readonly fillFrames: readonly number[];
}

/** The emitted `goods/manifest.json`: the app's contract for loading + binding good icons. */
export interface GoodsManifest {
  readonly indexedStem: string;
  readonly previewStem: string;
  readonly paletteLutStem: string;
  /** Palette LUT row order (row index = array index) — the app maps a {@link GoodIcon.palette} to its row. */
  readonly palettes: string[];
  /** good STRING id → its icon binding. */
  readonly icons: Record<string, GoodIcon>;
}

export interface GoodsStageSummary {
  readonly frames: number;
  readonly palettes: number;
  readonly icons: number;
}

/** Resolve a recolor palette by name across {@link PALETTE_DIRS}, or `undefined` if absent everywhere. */
async function loadGoodsPalette(gameDir: string, name: string): Promise<Uint8Array | undefined> {
  for (const dir of PALETTE_DIRS) {
    try {
      return decodePcx(await readGameFile(gameDir, join(dir, `${name}.pcx`))).palette;
    } catch {
      // try the next dir
    }
  }
  return undefined;
}

/** The good fields the icon join reads (a structural subset of the extractor's `GoodType`). */
interface GoodLike {
  readonly id: string;
  readonly landscapeType?: number | undefined;
}
/** The `[GfxLandscape]` fields the icon join reads (a structural subset of `LandscapeGfx`). */
interface PileGfxLike {
  readonly logicType: number;
  readonly editGroups: readonly string[];
  readonly bmd?: string | undefined;
  readonly paletteName?: string | undefined;
  readonly frames: readonly { readonly state: number; readonly bobIds: readonly number[] }[];
}

/**
 * Join goods onto the `[GfxLandscape]` good-pile records to produce, per good STRING id, its state-1
 * (smallest, single-unit) pile frame + recolor palette. Pure (no I/O), so the join rule is unit-tested.
 * A good with no on-map pile record — or a pile record with no palette / no frames — is omitted (no icon).
 */
export function resolveGoodIcons(
  goods: readonly GoodLike[],
  landscapeGfx: readonly PileGfxLike[],
): Record<string, GoodIcon> {
  // Good-pile records indexed by `logicType` (the good's `landscapeType`). First-wins is deterministic —
  // `extractLandscapeGfx` preserves file order, and a landscape type has one canonical good-pile record.
  const pileByLogic = new Map<number, PileGfxLike>();
  for (const rec of landscapeGfx) {
    if (!rec.editGroups.includes(GOOD_PILE_GROUP)) continue;
    if (!rec.bmd?.toLowerCase().includes(GOODS_ATLAS_STEM)) continue;
    if (!pileByLogic.has(rec.logicType)) pileByLogic.set(rec.logicType, rec);
  }

  const icons: Record<string, GoodIcon> = {};
  for (const good of goods) {
    if (good.landscapeType === undefined) continue;
    const rec = pileByLogic.get(good.landscapeType);
    if (rec === undefined || rec.paletteName === undefined) continue;
    const stateFrame =
      rec.frames.find((f) => f.state === ICON_PILE_STATE) ??
      [...rec.frames].sort((a, b) => a.state - b.state)[0];
    const bobId = stateFrame?.bobIds[0];
    if (bobId === undefined) continue;
    // Every growth state's first bob, ordered fewest→most units — the on-map heap indexes these by fill so
    // the pile grows with its contents (a single stone at state 1, a full heap at the record's max state).
    const fillFrames = [...rec.frames]
      .filter((f) => f.bobIds[0] !== undefined)
      .sort((a, b) => a.state - b.state)
      .map((f) => f.bobIds[0] as number);
    icons[good.id] = { frame: bobId, palette: rec.paletteName, fillFrames };
  }
  return icons;
}

/** Read `goodtypes.ini` + `landscapes.cif` and resolve the good→icon bindings ({@link resolveGoodIcons}). */
async function buildGoodIcons(gameDir: string): Promise<Record<string, GoodIcon>> {
  const goodSections = parseIniSections(decodeIni(await readGameFile(gameDir, GOODTYPES_INI)));
  const goods = extractGoods(goodSections, { file: GOODTYPES_INI, layer: 'base' });
  const { lines } = decodeCifStringArray(await readGameFile(gameDir, LANDSCAPES_CIF));
  const landscapeGfx = extractLandscapeGfx(cifLinesToSections(lines), {
    file: LANDSCAPES_CIF,
    layer: 'base',
  });
  return resolveGoodIcons(goods, landscapeGfx);
}

/**
 * Decode `ls_goods.bmd` into an indexed + preview atlas, stack the referenced recolor palettes into a LUT,
 * build the good→icon bindings, and write them under `outDir`. Warns-and-returns-empty if the atlas or good
 * tables are unreadable (a partial install still leaves the rest of the pipeline intact).
 */
export async function convertGoodsStage(gameDir: string, outDir: string): Promise<GoodsStageSummary> {
  let icons: Record<string, GoodIcon>;
  try {
    icons = await buildGoodIcons(gameDir);
  } catch (err) {
    console.warn(`[pipeline] goods: skipped (good tables unreadable): ${(err as Error).message}`);
    icons = {};
  }

  // The distinct recolor palettes the icons reference, in a deterministic (sorted) LUT row order. Include
  // the preview palette so the same LUT can colour the preview atlas if a consumer ever wants it.
  const paletteNames = [...new Set([...Object.values(icons).map((i) => i.palette), PREVIEW_PALETTE])].sort();
  const paletteByName = new Map<string, Uint8Array>();
  const ordered: Uint8Array[] = [];
  for (const name of paletteNames) {
    let palette = await loadGoodsPalette(gameDir, name);
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
    const indexed = packIndexedBobAtlas(bmd);
    const preview = packBobAtlas(bmd, paletteByName.get(PREVIEW_PALETTE) ?? identityPalette());
    await writeBobAtlas(outDir, GOODS_INDEXED_STEM, indexed);
    await writeBobAtlas(outDir, `${GOODS_ATLAS_STEM}.${PREVIEW_PALETTE}`, preview);
    frames = indexed.manifest.frames.length;
  } catch (err) {
    console.warn(`[pipeline] goods: atlas skipped (${GOODS_BMD} unreadable): ${(err as Error).message}`);
  }

  await mkdir(join(outDir, BOBS_DIR), { recursive: true });
  await writeFile(
    join(outDir, BOBS_DIR, `${GOODS_PALETTE_LUT_STEM}.png`),
    encodePng(buildPlayerLutImage(ordered)),
  );

  const manifest: GoodsManifest = {
    indexedStem: GOODS_INDEXED_STEM,
    previewStem: `${GOODS_ATLAS_STEM}.${PREVIEW_PALETTE}`,
    paletteLutStem: GOODS_PALETTE_LUT_STEM,
    palettes: paletteNames,
    icons,
  };
  await mkdir(join(outDir, GOODS_CONTENT_DIR), { recursive: true });
  await writeFile(join(outDir, GOODS_CONTENT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  return { frames, palettes: paletteNames.length, icons: Object.keys(icons).length };
}
