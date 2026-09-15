import { join } from 'node:path';
import { buildPaletteLutImage, PALETTE_ENTRIES, PALETTE_RGB_BYTES } from '../decoders/image.js';
import { decodePcx } from '../decoders/pcx.js';
import { encodePng } from '../decoders/png.js';
import { errorMessage } from '../errors.js';
import { writeFileWithParents } from '../files.js';
import type { SourceRoots } from '../roots.js';
import { BOBS_DIR } from './content-tree.js';
import { readSourceFile } from './source-files.js';

/** A neutral 256-colour grayscale palette (index i to (i,i,i)): the stand-in row for an absent carrier. */
export function identityPalette(): Uint8Array {
  const p = new Uint8Array(PALETTE_RGB_BYTES);
  for (let i = 0; i < PALETTE_ENTRIES; i++) p.fill(i, i * 3, i * 3 + 3);
  return p;
}

/** One palette-LUT carrier: a row name and the game-relative `.pcx` whose 256-colour trailer fills the row. */
export interface PaletteLutSource {
  readonly name: string;
  readonly file: string;
}

/** The emitted palette LUT plus the resolved palettes (for preview colouring + the manifest). */
export interface PaletteLutResult {
  /** `loadLayer`/`loadAtlasSource` stem of the `256 × N` LUT PNG under {@link BOBS_DIR}. */
  readonly stem: string;
  /** LUT row order (row index = array index) - the app mirrors this to pick a row. */
  readonly names: string[];
  /** name → 768-byte palette, for colouring the preview atlases. Absent palettes are identity-filled. */
  readonly byName: Map<string, Uint8Array>;
}

/**
 * Reads each `sources` carrier's 256-colour `.pcx` trailer and stacks them, in source order, into one
 * `256 x N` LUT PNG under {@link BOBS_DIR}. A missing or palette-less carrier is warned and replaced
 * with an {@link identityPalette} row, so a partial install still leaves the row order fixed.
 */
export async function buildPaletteLut(
  roots: SourceRoots,
  outDir: string,
  sources: readonly PaletteLutSource[],
  stem: string,
  log: { readonly label: string; readonly noun: string },
): Promise<PaletteLutResult> {
  const ordered: Uint8Array[] = [];
  const byName = new Map<string, Uint8Array>();
  for (const src of sources) {
    let palette: Uint8Array | undefined;
    try {
      palette = decodePcx(await readSourceFile(roots, src.file)).palette;
    } catch (err) {
      console.warn(
        `[pipeline] ${log.label}: ${log.noun} ${src.name} unreadable (${errorMessage(err)}); using neutral row`,
      );
    }
    if (palette === undefined) palette = identityPalette();
    ordered.push(palette);
    byName.set(src.name, palette);
  }
  await writeLutPng(outDir, stem, ordered);
  return { stem, names: sources.map((s) => s.name), byName };
}

/**
 * Stacks `orderedPalettes` (one 768-byte RGB row per LUT slot, in row order) into a `256 x N` LUT PNG at
 * `<BOBS_DIR>/<stem>.png`.
 */
export async function writeLutPng(
  outDir: string,
  stem: string,
  orderedPalettes: readonly Uint8Array[],
): Promise<void> {
  await writeFileWithParents(
    join(outDir, BOBS_DIR, `${stem}.png`),
    await encodePng(buildPaletteLutImage(orderedPalettes)),
  );
}
