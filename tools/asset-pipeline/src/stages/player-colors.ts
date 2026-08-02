import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ARMOR_PALETTE_TIERS,
  applyArmorRecipe,
  cutRamp,
  extractArmorRecipes,
} from '../decoders/armor-palette.js';
import { packBobAtlas, packIndexedBobAtlas } from '../decoders/atlas.js';
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
import { BOBS_DIR, writeAtlasBeside } from './content-tree.js';
import { readSourceFile, type SourceAssetIndex } from './source-files.js';

/**
 * Player-colour pipeline stage - the render-time-recolour twin of {@link import('./bmd.js').convertBmdTree}.
 * Where that stage bakes one palette into each atlas, this stage keeps the human character bobs recolourable
 * per player: it emits (a) an indexed atlas per character `.bmd` (palette index in red, mask in alpha -
 * no colour applied) and (b) a single colour LUT PNG (256 wide, one composed palette row per
 * (armor tier, player); see {@link convertPlayerColorLut}). The renderer reads each atlas index through
 * the row, so one indexed atlas serves every player colour and armor recolor (see `packages/render`
 * palette-LUT shader + `source basis`).
 *
 * Not the original's mechanism byte-for-byte (it composes a per-creature palette at spawn from
 * `randompalette.ini`); it is the same idea - the player colour is decided by the palette the `.bmd` index is
 * read through - moved to draw time so up to 16 players share one atlas texture. Boundary failures are
 * warned-and-skipped, never fatal, matching the other tree-walk stages.
 */

/** Directory holding the creature `.pcx` palettes the LUT is built from. */
const CREATURES_DIR = join('Data', 'engine2d', 'bin', 'palettes', 'creatures');
/** The shared human body base palette (the mod's `gfxpalettebasebody`); its band is swapped per player. */
const BASE_PALETTE_PCX = 'test_human_00.pcx';
/** The reference ramp the six synthetic (no-original) player colours are hue-rotated from. */
const SYNTHETIC_REFERENCE_PCX = 'player01.pcx';
/** Human character bobs get the recolourable indexed atlas; everything else keeps its baked RGB atlas. */
const CHARACTER_BMD_RE = /(^|\/)cr_hum_/i;
/** The guidepost bob - drawn through the player's own FULL palette in the original (source basis: the
 *  board-text indices 23–30 sit inside the `playerNN.pcx` player ramp - blue for player 1, red for
 *  player 2 - and those palettes carry the wood ramp at the body indices 131–141). Unlike the character
 *  bobs it has heavily graded edge alpha (25% of its visible pixels), which the binary-alpha indexed
 *  path would shred - so it gets per-player BAKED atlases instead ({@link convertGuidepostPlayerAtlases}). */
const GUIDEPOST_BMD = 'data/engine2d/bin/bobs/ls_guidepost.bmd';

/**
 * Read a `creatures/<file>.pcx` 768-byte trailer palette from the winning source layer, resolved
 * case-insensitively via `tree` ({@link SourceAssetIndex}) - each layer keeps its own (unpredictable)
 * case, so a direct `join` would miss on a case-sensitive filesystem (Linux CI), exactly why the bmd
 * stage resolves the same way. Throws if the file is in no layer or has no palette trailer.
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
  /** Row blocks in the LUT: 1 = player rows only (armor recipes unreadable), else
   *  {@link ARMOR_PALETTE_TIERS} (see {@link convertPlayerColorLut} for the row scheme). */
  readonly armorTiers: number;
}

/** The `[RandomPalette]` recipe file naming the `human_armor_%3.3d` armor recolors. */
const RANDOMPALETTE_INI = join('Data', 'engine2d', 'inis', 'humans', 'randompalette.ini');
/** The named-palette graph (`[GfxPalette256]` files + `[GfxPalette16]` ramps) the recipes patch from. */
const PALETTES_INI = join('Data', 'engine2d', 'inis', 'palettes', 'palettes.ini');

/**
 * The armor-tier recolor rows for one composed player palette: `[tier 1 .. tier 4]`, each the player
 * palette with that `human_armor_00N` recipe's patches applied (see decoders/armor-palette.ts). Tier 0
 * (unarmored) is the plain player palette: the original's `human_armor_000` mirror of the team band
 * onto patches 9/11/12 is deliberately not applied, keeping today's unarmored looks byte-identical -
 * a named approximation.
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
 * Build the per-player palettes (the original's 10 `playerNN.pcx` + 6 hue-rotated extras) and their
 * armor recolors, stack them into a `256×(16·tiers)` LUT PNG (`row = 16*armorTier + player`; rows
 * 0-15 are the plain player rows, byte-identical to the pre-armor LUT), and write it under `<out>`'s
 * bobs dir. Player sources come from the layer that wins each `.pcx`; the armor recipes and ramp
 * palettes are read from the loose roots (`randompalette.ini`/`palettes.ini` ship as plaintext). Throws on a
 * missing base/reference palette; unreadable armor recipes degrade to the 16-row player-only LUT
 * (warned), never failing the stage. Row semantics are a code contract with the app (`PLAYER_COLORS`
 * slot order, `ARMOR_PALETTE_TIERS` blocks), so no sidecar descriptor is needed.
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
 * Bake one guidepost atlas per player (`ls_guidepost.player_NN.{png,atlas.json}`): the bob decoded
 * through that player's FULL palette - the shipped `playerNN.pcx` verbatim for the faithful ten, the
 * hue-rotated reference for the six synthetic extras. Baked (not indexed+LUT) because the guidepost's
 * graded edge alpha survives only the RGB bake; the atlases are tiny (19 small bobs), so 16 of them
 * cost nothing next to one house sheet. Returns the emitted per-player atlas count.
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
    // The `player_NN` suffix is a string contract with the app loader (`guidepostPlayerAtlas`,
    // packages/app/src/content/sprite-sheet/human-sheet.ts) - a drift falls back silently to bridge01.
    const suffix = `player_${String(color.id).padStart(2, '0')}`;
    await writeAtlasBeside(outDir, source.rel, suffix, packBobAtlas(bmd, palette));
    emitted++;
  }
  return emitted;
}

/**
 * Emit an indexed atlas (`<bmd>.indexed.png` + `<bmd>.indexed.atlas.json`) for every human character `.bmd`
 * referenced by `bindings` (deduped - many bindings share one body). The `.bmd`s are read from the layer
 * that wins each reference, resolved case-insensitively via {@link SourceAssetIndex}. A missing/malformed
 * `.bmd` is warned-and-skipped. Returns the emitted PNG paths (relative to `<out>`).
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
      const { png } = await writeAtlasBeside(outDir, source.rel, 'indexed', atlas);
      done.push(png);
    } catch (err) {
      console.warn(`[pipeline] skipped indexed ${bmdRef}: ${errorMessage(err)}`);
    }
  }
  return done;
}
