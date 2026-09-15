import { VERTEX_PALETTE_ENTRIES, type VertexPalette } from '@open-northland/data';
import type { Vfs } from '@open-northland/vfs';
import { assertPaletteBytes } from '../decoders/image.js';
import { decodePcx } from '../decoders/pcx.js';
import type { SourceRoots } from '../roots.js';
import { writeJsonFile } from './content-tree.js';
import { readSourceFile } from './source-files.js';

/** The picture whose colour table a script's `SetVertexColor` indexes; its raster is irrelevant. */
const VERTEX_PALETTE_PCX = 'Data/engine2d/bin/palettes/misc/vertexcolors.pcx';
export const VERTEX_PALETTE_FILE = 'terrain-palettes/vertexcolors.json';

/** Writes the vertex colour palette as packed `0xRRGGBB` entries; throws when the mod ships none. */
export async function convertVertexPalette(
  fs: Vfs,
  roots: SourceRoots,
  outDir: string,
): Promise<VertexPalette> {
  const { palette } = decodePcx(await readSourceFile(fs, roots, VERTEX_PALETTE_PCX));
  if (palette === undefined) throw new Error(`${VERTEX_PALETTE_PCX} carries no colour table`);
  assertPaletteBytes(palette, 'vertex palette');
  const colors: number[] = [];
  for (let i = 0; i < VERTEX_PALETTE_ENTRIES; i++) {
    colors.push(((palette[3 * i] ?? 0) << 16) | ((palette[3 * i + 1] ?? 0) << 8) | (palette[3 * i + 2] ?? 0));
  }
  await writeJsonFile(fs, outDir, VERTEX_PALETTE_FILE, colors);
  return colors;
}
