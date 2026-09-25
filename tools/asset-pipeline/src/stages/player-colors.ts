import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PLAYER_LUT_ARMOR_BLOCKS, PLAYER_LUT_CART_RECIPES } from '@open-northland/data';
import {
  type ArmorRecipe,
  applyArmorRecipe,
  cutRamp,
  extractArmorRecipes,
  extractNamedRecipes,
} from '../decoders/armor-palette.js';
import { packBobAtlas, packIndexedBobAtlas } from '../decoders/atlas/index.js';
import { decodeBmd } from '../decoders/bmd/index.js';
import { buildPaletteLutImage } from '../decoders/image.js';
import {
  type BmdPaletteBinding,
  extractPaletteIndex,
  iniBytesToSections,
  normalizeAssetPath,
  paletteAliasMap,
  rampAliasMap,
} from '../decoders/ini.js';
import { decodePcx } from '../decoders/pcx.js';
import {
  composeHeadPalette,
  composePlayerPalette,
  PLAYER_COLORS,
  synthesizePlayerSource,
} from '../decoders/player-palette.js';
import { encodePng } from '../decoders/png.js';
import { errorMessage } from '../errors.js';
import { writeFileWithParents } from '../files.js';
import type { SourceRoots } from '../roots.js';
import { BOBS_DIR, INDEXED_ATLAS_SUFFIX, writeSourceBobAtlas } from './content-tree.js';
import { readSourceFile, type SourceAssetIndex } from './source-files.js';

/** Directory holding the creature `.pcx` palettes the LUT is built from. */
const CREATURES_DIR = 'Data/engine2d/bin/palettes/creatures';
/** The shared human body base palette (the mod's `gfxpalettebasebody`); its band is swapped per player. */
const BASE_PALETTE_PCX = 'test_human_00.pcx';
/** The reference ramp the six synthetic (no-original) player colours are hue-rotated from. */
const SYNTHETIC_REFERENCE_PCX = 'player01.pcx';
/** Human character bobs get the recolourable indexed atlas; everything else keeps its baked RGB atlas. */
const CHARACTER_BMD_RE = /(^|\/)cr_hum_/i;
/** The guidepost bob. Its board-text indices 23-30 sit inside the `playerNN.pcx` player ramp and those
 *  palettes carry the wood ramp at indices 131-141, so the original draws it through the player's own
 *  full palette. */
const GUIDEPOST_BMD = 'data/engine2d/bin/bobs/ls_guidepost.bmd';

/**
 * Reads a `creatures/<file>.pcx` 768-byte trailer palette from the layer that wins it. Throws when the
 * file is in no layer or carries no palette trailer.
 */
async function readCreaturePalette(tree: SourceAssetIndex, file: string): Promise<Uint8Array> {
  const source = tree.get(normalizeAssetPath(`${CREATURES_DIR}/${file}`));
  if (source === undefined) throw new Error(`player-colors: ${file} not found in any source layer`);
  const pal = decodePcx(await readFile(source.path)).palette;
  if (pal === undefined) throw new Error(`player-colors: ${file} has no 256-colour palette trailer`);
  return pal;
}

/** The LUT stage's emitted path + how many player colours and row blocks it composed. */
export interface PlayerColorLutResult {
  readonly png: string;
  readonly colors: number;
  /** Row blocks in the LUT: 1 when the recipes were unreadable, else the armor blocks and the cart blocks
   *  (`@open-northland/data` `player-lut.ts`). */
  readonly blocks: number;
  /** The row after the last block: the head palette, shared by every player and tier. */
  readonly headRow: number;
}

/** The `[RandomPalette]` recipe file naming the `human_armor_%3.3d` armor recolors. */
const RANDOMPALETTE_INI = 'Data/engine2d/inis/humans/randompalette.ini';
/** The named-palette graph (`[GfxPalette256]` files + `[GfxPalette16]` ramps) the recipes patch from. */
const PALETTES_INI = 'Data/engine2d/inis/palettes/palettes.ini';

/**
 * The recolor rows for one composed player palette, in LUT block order after the plain block: armor tiers
 * 1..4, each the player palette with that `human_armor_00N` recipe's patches applied, then the cart
 * recipes. Tier 0 stays the plain player palette; the original's `human_armor_000` mirror of the team band
 * onto patches 9/11/12 is not applied, a named approximation.
 */
async function recolorRowsFor(roots: SourceRoots): Promise<(palette: Uint8Array) => Uint8Array[]> {
  const paletteSections = iniBytesToSections(await readSourceFile(roots, PALETTES_INI));
  const aliases = paletteAliasMap(extractPaletteIndex(paletteSections));
  const ramps = rampAliasMap(paletteSections);
  const recipeSections = iniBytesToSections(await readSourceFile(roots, RANDOMPALETTE_INI));
  const armor = extractArmorRecipes(recipeSections);
  const tiers: ArmorRecipe[] = Array.from({ length: PLAYER_LUT_ARMOR_BLOCKS - 1 }, (_, i) => {
    const recipe = armor.find((r) => r.tier === i + 1);
    if (recipe === undefined) throw new Error(`armor-palette: recipe human_armor_00${i + 1} missing`);
    return recipe;
  });
  try {
    tiers.push(...extractNamedRecipes(recipeSections, PLAYER_LUT_CART_RECIPES, PLAYER_LUT_ARMOR_BLOCKS));
  } catch (err) {
    // The cart blocks trail the armor blocks, so the armor rows stand without them.
    console.warn(`[pipeline] cart recolor rows skipped: ${errorMessage(err)}`);
  }
  const sources = new Map<string, Uint8Array>(); // decoded [GfxPalette256] palettes by .pcx path
  const resolveRamp = (name: string): Uint8Array | undefined => {
    const ramp = ramps.get(name);
    const file = ramp === undefined ? undefined : aliases.get(ramp.source);
    const palette = file === undefined ? undefined : sources.get(file);
    return palette === undefined || ramp === undefined ? undefined : cutRamp(palette, ramp.range);
  };
  // Pre-read every ramp source .pcx once (the recipes reference a handful of files between them).
  for (const recipe of tiers) {
    for (const patch of recipe.patches) {
      if (patch.source.kind !== 'ramp') continue;
      const file = ramps.get(patch.source.name)?.source;
      const path = file === undefined ? undefined : aliases.get(file);
      if (path === undefined || sources.has(path)) continue;
      const palette = decodePcx(await readSourceFile(roots, path)).palette;
      if (palette !== undefined) sources.set(path, palette);
    }
  }
  return (palette) => tiers.map((recipe) => applyArmorRecipe(palette, recipe, resolveRamp));
}

/**
 * Builds the per-player palettes and their armor and cart recolors and stacks them into a
 * `256 x (16 * blocks + 1)` LUT PNG at `row = 16 * block + player`, with the head palette as the one row
 * after the blocks. Throws on a missing base or reference palette; unreadable recipes degrade to the
 * 16-row player-only block.
 */
export async function convertPlayerColorLut(
  roots: SourceRoots,
  outDir: string,
  tree: SourceAssetIndex,
): Promise<PlayerColorLutResult> {
  const base = await readCreaturePalette(tree, BASE_PALETTE_PCX);
  const reference = await readCreaturePalette(tree, SYNTHETIC_REFERENCE_PCX);
  const palettes: Uint8Array[] = [];
  for (const color of PLAYER_COLORS) {
    const source =
      color.source.kind === 'pcx'
        ? await readCreaturePalette(tree, color.source.file)
        : synthesizePlayerSource(reference, color.source.hue);
    palettes.push(composePlayerPalette(base, source));
  }
  let blocks = 1;
  try {
    const recolorRows = await recolorRowsFor(roots);
    const recolored = palettes.map((palette) => recolorRows(palette)); // [player] -> [block 1..]
    const extraBlocks = recolored[0]?.length ?? 0;
    for (let block = 0; block < extraBlocks; block++) {
      for (const rows of recolored) {
        const row = rows[block];
        if (row === undefined) throw new Error(`armor-palette: block ${block + 1} row missing`);
        palettes.push(row);
      }
    }
    blocks = 1 + extraBlocks;
  } catch (err) {
    console.warn(`[pipeline] recolor rows skipped: ${errorMessage(err)}`);
  }
  const headRow = palettes.length;
  palettes.push(composeHeadPalette(base));
  const pngRel = `${BOBS_DIR}/player-lut.png`;
  await writeFileWithParents(join(outDir, pngRel), await encodePng(buildPaletteLutImage(palettes)));
  return { png: pngRel, colors: PLAYER_COLORS.length, blocks, headRow };
}

/**
 * Bakes one guidepost atlas per player (`ls_guidepost.player_NN.{png,atlas.json}`), decoded through
 * that player's full source palette. Baked rather than indexed plus LUT because the LUT rows carry
 * composed human palettes, which differ from it at every index the guidepost draws.
 */
export async function convertGuidepostPlayerAtlases(outDir: string, tree: SourceAssetIndex): Promise<number> {
  const source = tree.get(normalizeAssetPath(GUIDEPOST_BMD));
  if (source === undefined) {
    throw new Error('guidepost atlases: ls_guidepost.bmd not found in any source layer');
  }
  const bmd = decodeBmd(await readFile(source.path));
  const reference = await readCreaturePalette(tree, SYNTHETIC_REFERENCE_PCX);
  let emitted = 0;
  for (const color of PLAYER_COLORS) {
    const palette =
      color.source.kind === 'pcx'
        ? await readCreaturePalette(tree, color.source.file)
        : synthesizePlayerSource(reference, color.source.hue);
    // The `player_NN` suffix is a string contract with the app's `guidepostPlayerAtlas`; a drift there
    // falls back silently to bridge01.
    const suffix = `player_${String(color.id).padStart(2, '0')}`;
    await writeSourceBobAtlas(outDir, source.rel, suffix, packBobAtlas(bmd, palette));
    emitted++;
  }
  return emitted;
}

/**
 * Emits an indexed atlas (`<bmd-basename>.indexed.{png,atlas.json}`) for every human character `.bmd`
 * in `bindings`, deduped because many bindings share one body. A missing or malformed `.bmd` is skipped
 * with a warning.
 */
export async function convertIndexedCharacterAtlases(
  bindings: readonly BmdPaletteBinding[],
  outDir: string,
  tree: SourceAssetIndex,
): Promise<string[]> {
  const characterBmds = new Set<string>();
  for (const b of bindings) {
    if (CHARACTER_BMD_RE.test(b.bmd) && /\.bmd$/i.test(b.bmd)) characterBmds.add(b.bmd);
  }
  const done: string[] = [];
  for (const bmdRef of characterBmds) {
    const source = tree.get(bmdRef);
    if (source === undefined) {
      console.warn(`[pipeline] skipped indexed ${bmdRef}: not found in any source layer`);
      continue;
    }
    try {
      const atlas = packIndexedBobAtlas(decodeBmd(await readFile(source.path)));
      const { png } = await writeSourceBobAtlas(outDir, source.rel, INDEXED_ATLAS_SUFFIX, atlas);
      done.push(png);
    } catch (err) {
      console.warn(`[pipeline] skipped indexed ${bmdRef}: ${errorMessage(err)}`);
    }
  }
  return done;
}
