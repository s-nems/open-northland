import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { packBobAtlas, packIndexedBobAtlas } from '../decoders/atlas.js';
import { decodeBmd } from '../decoders/bmd/index.js';
import { buildPaletteLutImage } from '../decoders/image.js';
import { type BmdPaletteBinding, normalizeAssetPath } from '../decoders/ini.js';
import { decodePcx } from '../decoders/pcx.js';
import { composePlayerPalette, PLAYER_COLORS, synthesizePlayerSource } from '../decoders/player-palette.js';
import { encodePng } from '../decoders/png.js';
import { errorMessage } from '../errors.js';
import type { OutTreeIndex } from './bmd/index.js';
import { BOBS_DIR, writeAtlasBeside } from './content-tree.js';

/**
 * Player-colour pipeline stage — the render-time-recolour twin of {@link import('./bmd.js').convertBmdTree}.
 * Where that stage bakes one palette into each atlas, this stage keeps the human character bobs recolourable
 * per player: it emits (a) an indexed atlas per character `.bmd` (palette index in red, mask in alpha —
 * no colour applied) and (b) a single player-colour LUT PNG (256×16, one composed palette row per player)
 * plus a small descriptor JSON. The renderer reads each atlas index through the player's LUT row, so one
 * indexed atlas serves all 16 player colours (see `packages/render` palette-LUT shader + `source basis`).
 *
 * Not the original's mechanism byte-for-byte (it composes a per-creature palette at spawn from
 * `randompalette.ini`); it is the same idea — the player colour is decided by the palette the `.bmd` index is
 * read through — moved to draw time so up to 16 players share one atlas texture. Boundary failures are
 * warned-and-skipped, never fatal, matching the other tree-walk stages.
 */

/** Directory (relative to the unpacked tree) holding the creature `.pcx` palettes the LUT is built from. */
const CREATURES_DIR = join('Data', 'engine2d', 'bin', 'palettes', 'creatures');
/** The shared human body base palette (the mod's `gfxpalettebasebody`); its band is swapped per player. */
const BASE_PALETTE_PCX = 'test_human_00.pcx';
/** The reference ramp the six synthetic (no-original) player colours are hue-rotated from. */
const SYNTHETIC_REFERENCE_PCX = 'player01.pcx';
/** Human character bobs get the recolourable indexed atlas; everything else keeps its baked RGB atlas. */
const CHARACTER_BMD_RE = /(^|\/)cr_hum_/i;
/** The guidepost bob — drawn through the player's own FULL palette in the original (source basis: the
 *  board-text indices 23–30 sit inside the `playerNN.pcx` player ramp — blue for player 1, red for
 *  player 2 — and those palettes carry the wood ramp at the body indices 131–141). Unlike the character
 *  bobs it has heavily graded edge alpha (25% of its visible pixels), which the binary-alpha indexed
 *  path would shred — so it gets per-player BAKED atlases instead ({@link convertGuidepostPlayerAtlases}). */
const GUIDEPOST_BMD = 'data/engine2d/bin/bobs/ls_guidepost.bmd';

/**
 * Read a `creatures/<file>.pcx` 768-byte trailer palette from the unpacked tree, resolved case-insensitively
 * via `tree` ({@link OutTreeIndex}) — the archive members keep their original (unpredictable) case, so a direct
 * `join` would miss on a case-sensitive filesystem (Linux CI), exactly why the bmd stage resolves the same way.
 * Throws if the file is absent from `<out>` or has no palette trailer.
 */
async function readCreaturePalette(outDir: string, tree: OutTreeIndex, file: string): Promise<Uint8Array> {
  const key = normalizeAssetPath(join(CREATURES_DIR, file));
  const onDisk = tree.get(key);
  if (onDisk === undefined) throw new Error(`player-colors: ${file} not found under out`);
  const pal = decodePcx(await readFile(join(outDir, onDisk))).palette;
  if (pal === undefined) throw new Error(`player-colors: ${file} has no 256-colour palette trailer`);
  return pal;
}

/** The LUT stage's emitted path + how many player colours it composed. */
export interface PlayerColorLutResult {
  readonly png: string;
  readonly colors: number;
}

/**
 * Build the 16 per-player palettes (the original's 10 `playerNN.pcx` + 6 hue-rotated extras), stack them into
 * a `256×16` LUT PNG, and write it under `<out>`'s bobs dir. Reads the base + `playerNN.pcx` sources from the
 * same `<out>` tree (the pipeline unpacked them there). Throws on a missing base/reference palette — those are
 * required for any player colour to exist. The colours' names/ids live in code (`PLAYER_COLORS`, mirrored
 * app-side for the gallery labels) and the LUT row order is that slot order, so no sidecar descriptor is needed.
 */
export async function convertPlayerColorLut(
  outDir: string,
  tree: OutTreeIndex,
): Promise<PlayerColorLutResult> {
  const base = await readCreaturePalette(outDir, tree, BASE_PALETTE_PCX);
  const reference = await readCreaturePalette(outDir, tree, SYNTHETIC_REFERENCE_PCX);
  const palettes: Uint8Array[] = [];
  for (const color of PLAYER_COLORS) {
    const source =
      color.source.kind === 'pcx'
        ? await readCreaturePalette(outDir, tree, color.source.file)
        : synthesizePlayerSource(reference, color.source.hue);
    palettes.push(composePlayerPalette(base, source));
  }
  await mkdir(join(outDir, BOBS_DIR), { recursive: true }); // bobs dir may not exist if no atlas landed there
  const pngRel = join(BOBS_DIR, 'player-lut.png');
  await writeFile(join(outDir, pngRel), encodePng(buildPaletteLutImage(palettes)));
  return { png: pngRel, colors: palettes.length };
}

/**
 * Bake one guidepost atlas per player (`ls_guidepost.player_NN.{png,atlas.json}`): the bob decoded
 * through that player's FULL palette — the shipped `playerNN.pcx` verbatim for the faithful ten, the
 * hue-rotated reference for the six synthetic extras. Baked (not indexed+LUT) because the guidepost's
 * graded edge alpha survives only the RGB bake; the atlases are tiny (19 small bobs), so 16 of them
 * cost nothing next to one house sheet. Returns the emitted per-player atlas count.
 */
export async function convertGuidepostPlayerAtlases(outDir: string, tree: OutTreeIndex): Promise<number> {
  const onDisk = tree.get(normalizeAssetPath(GUIDEPOST_BMD));
  if (onDisk === undefined) throw new Error('guidepost atlases: ls_guidepost.bmd not found under out');
  const bmd = decodeBmd(await readFile(join(outDir, onDisk)));
  const reference = await readCreaturePalette(outDir, tree, SYNTHETIC_REFERENCE_PCX);
  let emitted = 0;
  for (const color of PLAYER_COLORS) {
    const palette =
      color.source.kind === 'pcx'
        ? await readCreaturePalette(outDir, tree, color.source.file)
        : synthesizePlayerSource(reference, color.source.hue);
    // The `player_NN` suffix is a string contract with the app loader (`guidepostPlayerAtlas`,
    // packages/app/src/content/sprite-sheet/human-sheet.ts) — a drift falls back silently to bridge01.
    const suffix = `player_${String(color.id).padStart(2, '0')}`;
    await writeAtlasBeside(outDir, onDisk, suffix, packBobAtlas(bmd, palette));
    emitted++;
  }
  return emitted;
}

/**
 * Emit an indexed atlas (`<bmd>.indexed.png` + `<bmd>.indexed.atlas.json`) for every human character `.bmd`
 * referenced by `bindings` (deduped — many bindings share one body). The `.bmd`s are read from the unpacked
 * `<out>` tree, resolved case-insensitively via {@link OutTreeIndex}. A missing/malformed `.bmd` is
 * warned-and-skipped. Returns the emitted PNG paths (relative to `<out>`).
 */
export async function convertIndexedCharacterAtlases(
  bindings: readonly BmdPaletteBinding[],
  outDir: string,
  tree: OutTreeIndex,
): Promise<string[]> {
  const characterBmds = new Set<string>();
  for (const b of bindings) {
    if (CHARACTER_BMD_RE.test(b.bmd) && /\.bmd$/i.test(b.bmd)) characterBmds.add(b.bmd);
  }
  const done: string[] = [];
  for (const bmdRef of characterBmds) {
    const onDisk = tree.get(bmdRef);
    if (onDisk === undefined) {
      console.warn(`[pipeline] skipped indexed ${bmdRef}: not found under out`);
      continue;
    }
    try {
      const atlas = packIndexedBobAtlas(decodeBmd(await readFile(join(outDir, onDisk))));
      const { png } = await writeAtlasBeside(outDir, onDisk, 'indexed', atlas);
      done.push(png);
    } catch (err) {
      console.warn(`[pipeline] skipped indexed ${bmdRef}: ${errorMessage(err)}`);
    }
  }
  return done;
}
