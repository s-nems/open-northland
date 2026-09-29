import { readFile } from 'node:fs/promises';
import { packBobAtlas, packIndexedBobAtlas } from '../decoders/atlas/index.js';
import { decodeBmd } from '../decoders/bmd/index.js';
import { type BmdPaletteBinding, normalizeAssetPath } from '../decoders/ini.js';
import { decodePcx } from '../decoders/pcx.js';
import { PLAYER_COLORS, synthesizePlayerSource } from '../decoders/player-palette.js';
import { errorMessage } from '../errors.js';
import { INDEXED_ATLAS_SUFFIX, writeSourceBobAtlas } from './content-tree.js';
import type { SourceAssetIndex } from './source-files.js';

/** Directory holding the creature `.pcx` palettes, the `playerNN.pcx` player colours among them. */
const CREATURES_DIR = 'Data/engine2d/bin/palettes/creatures';
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

/**
 * Bakes one guidepost atlas per player (`ls_guidepost.player_NN.{png,atlas.json}`), decoded through
 * that player's full source palette, which differs from a composed human palette at every index the
 * guidepost draws.
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
