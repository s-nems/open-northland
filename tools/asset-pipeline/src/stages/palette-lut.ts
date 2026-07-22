import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildPaletteLutImage, PALETTE_ENTRIES, PALETTE_RGB_BYTES } from '../decoders/image.js';
import { decodePcx } from '../decoders/pcx.js';
import { encodePng } from '../decoders/png.js';
import { errorMessage } from '../errors.js';
import type { SourceRoots } from '../roots.js';
import { BOBS_DIR } from './content-tree.js';
import { readSourceFile } from './source-files.js';

/**
 * A neutral 256-colour grayscale palette (index i → (i,i,i)), used to keep a colour-LUT row stable when a
 * palette carrier is absent, so the LUT's row order (the app-side contract) stays fixed regardless of a
 * partial install.
 */
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
  /** LUT row order (row index = array index) — the app mirrors this to pick a row. */
  readonly names: string[];
  /** name → 768-byte palette, for colouring the preview atlases. Absent palettes are identity-filled. */
  readonly byName: Map<string, Uint8Array>;
}

/**
 * Reads each `sources` carrier's 256-colour `.pcx` trailer, stacks them (in source order) into one
 * `256 × N` LUT PNG under {@link BOBS_DIR}, and returns the stem + row order + name→palette map. A
 * missing/palette-less carrier is warned (`[pipeline] ${log.label}: ${log.noun} <name> unreadable …`)
 * and replaced with an {@link identityPalette} row so the row order (the app-side contract) stays fixed
 * regardless of a partial install. Shared by the GUI-palette and font-colour LUT stages, which differ
 * only in their carrier list, stem, and log wording.
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
 * Stacks `orderedPalettes` (one 768-byte RGB row per LUT slot, in row order) into a `256 × N` player-LUT
 * PNG at `<BOBS_DIR>/<stem>.png`. The single emit step every palette-LUT stage ends with — the row
 * resolution differs per stage (fixed carrier files vs the goods alias graph), the write does not.
 */
export async function writeLutPng(
  outDir: string,
  stem: string,
  orderedPalettes: readonly Uint8Array[],
): Promise<void> {
  await mkdir(join(outDir, BOBS_DIR), { recursive: true });
  await writeFile(join(outDir, BOBS_DIR, `${stem}.png`), encodePng(buildPaletteLutImage(orderedPalettes)));
}
