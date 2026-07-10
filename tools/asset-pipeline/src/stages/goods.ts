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
  extractPaletteIndex,
  extractStringnById,
  latin1ToCp1250,
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
 * stone, a small wheat sheaf), not a code-pinned lookup (OpenVikings has no good→icon table). A good binds to
 * its dedicated `good piles all` pile record when it has one (tools/weapons/crockery/armour/food all do),
 * else falls back to its broader `goods all` item record ({@link GOOD_ITEM_GROUP}) — `fruit`, the six potions
 * (bottles), and the six amulets (rings) have only that, so the fallback recovers their real bottle/ring/fruit
 * graphic (recoloured per potion type / amulet) instead of leaving them iconless. Only the goods sharing
 * `landscapeType 1` with no record at all (prey, sheep, cattle, hand/ox carts, ships, catapult, chest) stay
 * unbound and render iconless.
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
/** The palette ALIAS table: `[GfxPalette256]` records mapping a palette editname (`gold01`) to its real
 *  `.pcx` — a name rarely names a `<name>.pcx` file directly (`gold01` → `landscapes/gold.pcx`). */
const PALETTES_INI = join('Data', 'engine2d', 'inis', 'palettes', 'palettes.ini');
/** Fallback dirs a `goods_*` recolor palette `.pcx` may live in when the alias table has no entry. */
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
/**
 * The broader `editGroups` membership marking ANY good's `ls_goods` graphic — the fallback icon source for a
 * good with no `good piles all` pile record. The potions (bottles, frames 125–129/145–149), amulets (rings,
 * 150–154) and fruit have only a `goods all` record — their own real `ls_goods` graphic + palette — never a
 * dedicated pile, so keying on it recovers a faithful bottle/ring/fruit icon instead of the neutral wood
 * fallback. A good WITH a pile record keeps it (piles preferred), so the 42 already-bound goods don't move.
 */
const GOOD_ITEM_GROUP = 'goods all';
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
  /**
   * Localized DISPLAY names: locale code → (good STRING id → name), extracted from the game's own
   * `text/<lang>/strings/gameobjects/goods.{ini,cif}` string tables (see {@link GOOD_NAME_LOCALES}). The
   * app resolves a good's shown name through this with a locale fallback chain, so the whole catalog reads
   * in the player's language and adding a language is a data edit, not code. A locale whose string file is
   * missing is simply absent (the app falls back to the next locale, then the machine id).
   */
  readonly names: Record<string, Record<string, string>>;
}

export interface GoodsStageSummary {
  readonly frames: number;
  readonly palettes: number;
  readonly icons: number;
}

/** A palette editname (lower-cased) → its real `.pcx` path, from {@link PALETTES_INI}. Built once per run. */
type PaletteAliasMap = ReadonlyMap<string, string>;

/** Read {@link PALETTES_INI} into a name→`.pcx` alias map (the same graph the bmd stage uses). Empty (and
 *  warned) when the file is unreadable, so palette resolution degrades to the {@link PALETTE_DIRS} search. */
async function loadPaletteAliases(gameDir: string): Promise<PaletteAliasMap> {
  const map = new Map<string, string>();
  try {
    const sections = parseIniSections(decodeIni(await readGameFile(gameDir, PALETTES_INI)));
    for (const alias of extractPaletteIndex(sections)) {
      if (!map.has(alias.name)) map.set(alias.name, alias.gfxFile);
    }
  } catch (err) {
    console.warn(`[pipeline] goods: palettes.ini unreadable (${(err as Error).message}); resolving by path`);
  }
  return map;
}

/**
 * Resolve a recolor palette by name to its 256-colour table. FIRST via the {@link PALETTES_INI} alias graph
 * (`gold01` → `landscapes/gold.pcx`) — a palette name rarely matches a `<name>.pcx` file directly, so without
 * this the aliased landscape palettes (`gold01`/`clay01`/`house_saracen01`/`human_colors`) fall to a neutral
 * row and their goods render washed-out white in the HUD (the coin, the plate/wool armour). Falls back to the
 * direct {@link PALETTE_DIRS} search for a name with no alias entry; `undefined` if unresolved everywhere.
 */
async function loadGoodsPalette(
  gameDir: string,
  name: string,
  aliases: PaletteAliasMap,
): Promise<Uint8Array | undefined> {
  const aliased = aliases.get(name.toLowerCase());
  if (aliased !== undefined) {
    try {
      return decodePcx(await readGameFile(gameDir, aliased)).palette;
    } catch {
      // aliased file unreadable — fall through to the by-path search
    }
  }
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
  // `ls_goods` records indexed by `logicType` (the good's `landscapeType`), split by group: the dedicated
  // PILE record (`good piles all`) is preferred, the broader ITEM record (`goods all`) is the fallback for a
  // good with no pile (potions/amulets/fruit). First-wins is deterministic — `extractLandscapeGfx` preserves
  // file order, and a landscape type has one canonical record per group. A pile record is usually ALSO in
  // `goods all`, so both maps may hold it; preferring the pile map keeps the already-bound goods unchanged.
  const pileByLogic = new Map<number, PileGfxLike>();
  const itemByLogic = new Map<number, PileGfxLike>();
  for (const rec of landscapeGfx) {
    if (!rec.bmd?.toLowerCase().includes(GOODS_ATLAS_STEM)) continue;
    if (rec.editGroups.includes(GOOD_PILE_GROUP) && !pileByLogic.has(rec.logicType)) {
      pileByLogic.set(rec.logicType, rec);
    }
    if (rec.editGroups.includes(GOOD_ITEM_GROUP) && !itemByLogic.has(rec.logicType)) {
      itemByLogic.set(rec.logicType, rec);
    }
  }

  const icons: Record<string, GoodIcon> = {};
  for (const good of goods) {
    if (good.landscapeType === undefined) continue;
    const rec = pileByLogic.get(good.landscapeType) ?? itemByLogic.get(good.landscapeType);
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
  const { lines } = decodeCifStringArray(await readGameFile(gameDir, LANDSCAPES_CIF));
  const landscapeGfx = extractLandscapeGfx(cifLinesToSections(lines), {
    file: LANDSCAPES_CIF,
    layer: 'base',
  });
  return resolveGoodIcons(await loadGoods(gameDir), landscapeGfx);
}

/** Parse `goodtypes.ini` into the goods list (the id/typeId/landscapeType the icon + name joins key off). */
async function loadGoods(gameDir: string): Promise<readonly (GoodLike & { readonly typeId: number })[]> {
  const sections = parseIniSections(decodeIni(await readGameFile(gameDir, GOODTYPES_INI)));
  return extractGoods(sections, { file: GOODTYPES_INI, layer: 'base' });
}

/**
 * The languages whose localized good-name table we extract, most-preferred first. Each good-name string
 * file lives at `text/<dir>/strings/gameobjects/goods.{ini,cif}`; the mod ships Polish as a plaintext `.ini`
 * (CP1250, decoded directly) and English/German as encrypted `.cif` (latin1 through the oracle seam, then
 * re-decoded to CP1250 for display). Russian ships too but in CP1251, a distinct codepage this seam doesn't
 * yet handle, so it is intentionally omitted rather than shipped as mojibake.
 */
const GOOD_NAME_LOCALES = [
  { code: 'pl', dir: 'pol', encrypted: false },
  { code: 'en', dir: 'eng', encrypted: true },
  { code: 'de', dir: 'ger', encrypted: true },
] as const;

/** Path of a locale's good-name string table (plaintext `.ini` when not encrypted, else the `.cif`). */
function goodNamesPath(dir: string, encrypted: boolean): string {
  return join('Data', 'text', dir, 'strings', 'gameobjects', encrypted ? 'goods.cif' : 'goods.ini');
}

/**
 * Join the localized good-name string tables (good `type` → display name, per locale) onto the goods by
 * `typeId`, producing `locale → (good STRING id → name)`. Pure (no I/O) so the join is unit-tested. A good
 * absent from a locale's table (or a locale with no table) simply gets no entry there; the app's fallback
 * chain covers it. The `type`-keyed singular is the faithful display name (see {@link extractStringnById}).
 */
export function resolveGoodNames(
  goods: readonly (GoodLike & { readonly typeId: number })[],
  tablesByLocale: Readonly<Record<string, Record<number, string>>>,
): Record<string, Record<string, string>> {
  const names: Record<string, Record<string, string>> = {};
  for (const [locale, table] of Object.entries(tablesByLocale)) {
    const byId: Record<string, string> = {};
    for (const good of goods) {
      const name = table[good.typeId];
      if (name !== undefined) byId[good.id] = name;
    }
    if (Object.keys(byId).length > 0) names[locale] = byId;
  }
  return names;
}

/** Read every {@link GOOD_NAME_LOCALES} good-name table (missing files skipped) and join onto the goods. */
async function loadGoodNames(
  gameDir: string,
  goods: readonly (GoodLike & { readonly typeId: number })[],
): Promise<Record<string, Record<string, string>>> {
  const tables: Record<string, Record<number, string>> = {};
  for (const { code, dir, encrypted } of GOOD_NAME_LOCALES) {
    let bytes: Uint8Array;
    try {
      bytes = await readGameFile(gameDir, goodNamesPath(dir, encrypted));
    } catch {
      console.warn(`[pipeline] goods: name table for "${code}" missing; skipping that locale`);
      continue;
    }
    if (encrypted) {
      const sections = cifLinesToSections(decodeCifStringArray(bytes).lines);
      const raw = extractStringnById(sections);
      tables[code] = Object.fromEntries(
        Object.entries(raw).map(([id, text]) => [Number(id), latin1ToCp1250(text)]),
      );
    } else {
      tables[code] = extractStringnById(parseIniSections(decodeIni(bytes)));
    }
  }
  return resolveGoodNames(goods, tables);
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
  const paletteNames = [...new Set([...Object.values(icons).map((i) => i.palette), PREVIEW_PALETTE])].sort();
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
    names,
  };
  await mkdir(join(outDir, GOODS_CONTENT_DIR), { recursive: true });
  await writeFile(join(outDir, GOODS_CONTENT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  return { frames, palettes: paletteNames.length, icons: Object.keys(icons).length };
}
