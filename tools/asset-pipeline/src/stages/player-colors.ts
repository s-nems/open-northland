import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ARMOR_PALETTE_TIERS,
  applyArmorRecipe,
  cutRamp,
  extractArmorRecipes,
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
import { composePlayerPalette, PLAYER_COLORS, synthesizePlayerSource } from '../decoders/player-palette.js';
import { encodePng } from '../decoders/png.js';
import { errorMessage } from '../errors.js';
import type { SourceRoots } from '../roots.js';
import { BOBS_DIR, writeSourceBobAtlas } from './content-tree.js';
import { readSourceFile, type SourceAssetIndex } from './source-files.js';

/** Directory holding the creature `.pcx` palettes the LUT is built from. */
const CREATURES_DIR = join('Data', 'engine2d', 'bin', 'palettes', 'creatures');
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
  const source = tree.get(normalizeAssetPath(join(CREATURES_DIR, file)));
  if (source === undefined) throw new Error(`player-colors: ${file} not found in any source layer`);
  const pal = decodePcx(await readFile(source.path)).palette;
  if (pal === undefined) throw new Error(`player-colors: ${file} has no 256-colour palette trailer`);
  return pal;
}

/** The LUT stage's emitted path + how many player colours and armor tiers it composed. */
export interface PlayerColorLutResult {
  readonly png: string;
  readonly colors: number;
  /** Row blocks in the LUT: 1 when the armor recipes were unreadable, else {@link ARMOR_PALETTE_TIERS}. */
  readonly armorTiers: number;
}

/** The `[RandomPalette]` recipe file naming the `human_armor_%3.3d` armor recolors. */
const RANDOMPALETTE_INI = join('Data', 'engine2d', 'inis', 'humans', 'randompalette.ini');
/** The named-palette graph (`[GfxPalette256]` files + `[GfxPalette16]` ramps) the recipes patch from. */
const PALETTES_INI = join('Data', 'engine2d', 'inis', 'palettes', 'palettes.ini');

/**
 * The armor-tier recolor rows for one composed player palette: `[tier 1 .. tier 4]`, each the player
 * palette with that `human_armor_00N` recipe's patches applied. Tier 0 stays the plain player palette;
 * the original's `human_armor_000` mirror of the team band onto patches 9/11/12 is not applied, a named
 * approximation.
 */
async function armorRowsFor(roots: SourceRoots): Promise<(palette: Uint8Array) => Uint8Array[]> {
  const paletteSections = iniBytesToSections(await readSourceFile(roots, PALETTES_INI));
  const aliases = paletteAliasMap(extractPaletteIndex(paletteSections));
  const ramps = rampAliasMap(paletteSections);
  const recipes = extractArmorRecipes(iniBytesToSections(await readSourceFile(roots, RANDOMPALETTE_INI)));
  const sources = new Map<string, Uint8Array>(); // decoded [GfxPalette256] palettes by .pcx path
  const resolveRamp = (name: string): Uint8Array | undefined => {
    const ramp = ramps.get(name);
    const file = ramp === undefined ? undefined : aliases.get(ramp.source);
    const palette = file === undefined ? undefined : sources.get(file);
    return palette === undefined || ramp === undefined ? undefined : cutRamp(palette, ramp.range);
  };
  // Pre-read every ramp source .pcx once (the recipes reference 3 files between them).
  for (const recipe of recipes) {
    for (const patch of recipe.patches) {
      if (patch.source.kind !== 'ramp') continue;
      const file = ramps.get(patch.source.name)?.source;
      const path = file === undefined ? undefined : aliases.get(file);
      if (path === undefined || sources.has(path)) continue;
      const palette = decodePcx(await readSourceFile(roots, path)).palette;
      if (palette !== undefined) sources.set(path, palette);
    }
  }
  const tiers = Array.from({ length: ARMOR_PALETTE_TIERS - 1 }, (_, i) => {
    const recipe = recipes.find((r) => r.tier === i + 1);
    if (recipe === undefined) throw new Error(`armor-palette: recipe human_armor_00${i + 1} missing`);
    return recipe;
  });
  return (palette) => tiers.map((recipe) => applyArmorRecipe(palette, recipe, resolveRamp));
}

/**
 * Builds the per-player palettes and their armor recolors and stacks them into a `256 x (16 * tiers)`
 * LUT PNG at `row = 16 * armorTier + player`. Throws on a missing base or reference palette; unreadable
 * armor recipes degrade to the 16-row player-only LUT.
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
  let armorTiers = 1;
  try {
    const armorRows = await armorRowsFor(roots);
    const armored = palettes.map((palette) => armorRows(palette)); // [player] -> [tier 1..4]
    for (let tier = 1; tier < ARMOR_PALETTE_TIERS; tier++) {
      for (const rows of armored) {
        const row = rows[tier - 1];
        if (row === undefined) throw new Error(`armor-palette: tier ${tier} row missing`);
        palettes.push(row);
      }
    }
    armorTiers = ARMOR_PALETTE_TIERS;
  } catch (err) {
    console.warn(`[pipeline] armor recolor rows skipped: ${errorMessage(err)}`);
  }
  await mkdir(join(outDir, BOBS_DIR), { recursive: true }); // bobs dir may not exist if no atlas landed there
  const pngRel = join(BOBS_DIR, 'player-lut.png');
  await writeFile(join(outDir, pngRel), encodePng(buildPaletteLutImage(palettes)));
  return { png: pngRel, colors: PLAYER_COLORS.length, armorTiers };
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
      const { png } = await writeSourceBobAtlas(outDir, source.rel, 'indexed', atlas);
      done.push(png);
    } catch (err) {
      console.warn(`[pipeline] skipped indexed ${bmdRef}: ${errorMessage(err)}`);
    }
  }
  return done;
}
