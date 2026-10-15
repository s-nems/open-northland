import { readFile } from 'node:fs/promises';
import { packBobAtlas, packIndexedBobAtlas } from '@open-northland/formats/atlas/index';
import { type Bmd, decodeBmd } from '@open-northland/formats/bmd/index';
import { type BmdPaletteBinding, normalizeAssetPath } from '@open-northland/formats/ini';
import { decodePcx } from '@open-northland/formats/pcx';
import { PLAYER_COLORS, synthesizePlayerSource } from '@open-northland/formats/player-palette';
import { errorMessage } from '../errors.js';
import { INDEXED_ATLAS_SUFFIX, writeSourceBobAtlas } from './content-tree.js';
import type { SourceAssetIndex } from './source-files.js';

/** Directory holding the creature `.pcx` palettes, the `playerNN.pcx` player colours among them. */
const CREATURES_DIR = 'Data/engine2d/bin/palettes/creatures';
/** The reference ramp the six synthetic (no-original) player colours are hue-rotated from. */
const SYNTHETIC_REFERENCE_PCX = 'player01.pcx';
/** Human character bobs get the recolourable indexed atlas; everything else keeps its baked RGB atlas. */
const CHARACTER_BMD_RE = /(^|\/)cr_hum_/i;
/** A bob sheet the original draws through the owner's full `playerNN.pcx` palette, and the bobs of it
 *  the app draws that way (absent = every bob). */
interface PlayerPaletteSheet {
  readonly bmd: string;
  readonly bobs?: { readonly first: number; readonly last: number };
}

/**
 * The guidepost: its board-text indices 23-30 sit inside the `playerNN.pcx` player ramp and those
 * palettes carry the wood ramp at indices 131-141. The life hearts, `ls_gui_bubbles` bobs 11 (full) to
 * 21 (empty): every pixel indexes 18-29 of the player ramp.
 */
const PLAYER_PALETTE_SHEETS: readonly PlayerPaletteSheet[] = [
  { bmd: 'data/engine2d/bin/bobs/ls_guidepost.bmd' },
  { bmd: 'data/engine2d/bin/bobs/ls_gui_bubbles.bmd', bobs: { first: 11, last: 21 } },
];

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
 * Bakes one atlas per player and {@link PLAYER_PALETTE_SHEETS} entry (`<bmd>.player_NN.{png,atlas.json}`),
 * decoded through that player's full source palette, which differs from a composed human palette at
 * every index these bobs draw. Baked rather than indexed+LUT so the bobs' graded edge alpha survives.
 */
export async function convertPlayerPaletteAtlases(outDir: string, tree: SourceAssetIndex): Promise<number> {
  const sheets = PLAYER_PALETTE_SHEETS.map((sheet) => {
    const source = tree.get(normalizeAssetPath(sheet.bmd));
    if (source === undefined)
      throw new Error(`player palette atlases: ${sheet.bmd} not found in any source layer`);
    return { source, sheet };
  });
  const reference = await readCreaturePalette(tree, SYNTHETIC_REFERENCE_PCX);
  let emitted = 0;
  for (const { source, sheet } of sheets) {
    const bmd = onlyBobs(decodeBmd(await readFile(source.path)), sheet.bobs);
    for (const color of PLAYER_COLORS) {
      const palette =
        color.source.kind === 'pcx'
          ? await readCreaturePalette(tree, color.source.file)
          : synthesizePlayerSource(reference, color.source.hue);
      // The `player_NN` suffix is a string contract with the app's loaders (`guidepostPlayerAtlas`,
      // the life hearts); a drift there falls back silently.
      const suffix = `player_${String(color.id).padStart(2, '0')}`;
      await writeSourceBobAtlas(outDir, source.rel, suffix, packBobAtlas(bmd, palette));
      emitted++;
    }
  }
  return emitted;
}

/** The sheet cut to the bob id range `bobs`, keeping each bob's id; a bob decodes from its own line
 *  index, so the cut needs no other rewrite. */
function onlyBobs(bmd: Bmd, bobs: PlayerPaletteSheet['bobs']): Bmd {
  if (bobs === undefined) return bmd;
  const from = Math.max(0, bobs.first - bmd.firstBobId);
  const kept = bmd.bobs.slice(from, bobs.last - bmd.firstBobId + 1);
  return { ...bmd, firstBobId: bmd.firstBobId + from, bobCount: kept.length, bobs: kept };
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
