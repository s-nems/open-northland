import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { packIndexedBobAtlas } from '../decoders/atlas.js';
import { decodeBmd } from '../decoders/bmd.js';
import type { BmdPaletteBinding } from '../decoders/ini.js';
import { decodePcx } from '../decoders/pcx.js';
import {
  buildPlayerLutImage,
  composePlayerPalette,
  PLAYER_COLORS,
  synthesizePlayerSource,
} from '../decoders/player-palette.js';
import { encodePng } from '../decoders/png.js';
import { indexOutTree } from './bmd.js';
import { BOBS_DIR } from './game-file.js';

/**
 * Player-colour pipeline stage — the render-time-recolour twin of {@link import('./bmd.js').convertBmdTree}.
 * Where that stage BAKES one palette into each atlas, this stage keeps the human character bobs recolourable
 * per player: it emits (a) an **indexed** atlas per character `.bmd` (palette index in red, mask in alpha —
 * no colour applied) and (b) a single **player-colour LUT** PNG (256×16, one composed palette row per player)
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

/**
 * Read a `creatures/<file>.pcx` 768-byte trailer palette from the unpacked tree, resolved case-insensitively
 * via `tree` ({@link indexOutTree}) — the archive members keep their original (unpredictable) case, so a direct
 * `join` would miss on a case-sensitive filesystem (Linux CI), exactly why the bmd stage resolves the same way.
 * Throws if the file is absent from `<out>` or has no palette trailer.
 */
async function readCreaturePalette(
  outDir: string,
  tree: ReadonlyMap<string, string>,
  file: string,
): Promise<Uint8Array> {
  const key = join(CREATURES_DIR, file).replace(/\\/g, '/').toLowerCase();
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
 * app-side for the gallery labels) and the LUT row order IS that slot order, so no sidecar descriptor is needed.
 */
export async function convertPlayerColorLut(outDir: string): Promise<PlayerColorLutResult> {
  const tree = await indexOutTree(outDir);
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
  await writeFile(join(outDir, pngRel), encodePng(buildPlayerLutImage(palettes)));
  return { png: pngRel, colors: palettes.length };
}

/**
 * Emit an indexed atlas (`<bmd>.indexed.png` + `<bmd>.indexed.atlas.json`) for every human character `.bmd`
 * referenced by `bindings` (deduped — many bindings share one body). The `.bmd`s are read from the unpacked
 * `<out>` tree, resolved case-insensitively via {@link indexOutTree}. A missing/malformed `.bmd` is
 * warned-and-skipped. Returns the emitted PNG paths (relative to `<out>`).
 */
export async function convertIndexedCharacterAtlases(
  bindings: readonly BmdPaletteBinding[],
  outDir: string,
): Promise<string[]> {
  const tree = await indexOutTree(outDir);
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
      const pngRel = onDisk.replace(/\.bmd$/i, '.indexed.png');
      const manifestRel = onDisk.replace(/\.bmd$/i, '.indexed.atlas.json');
      await writeFile(join(outDir, pngRel), encodePng(atlas.image));
      await writeFile(join(outDir, manifestRel), `${JSON.stringify(atlas.manifest, null, 2)}\n`);
      done.push(pngRel);
    } catch (err) {
      console.warn(`[pipeline] skipped indexed ${bmdRef}: ${(err as Error).message}`);
    }
  }
  return done;
}
