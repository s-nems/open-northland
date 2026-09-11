import { withBaseUrl } from '../base-url.js';
import { diag } from '../diag/index.js';

const PCX_HEADER_BYTES = 128;
const PALETTE_COLORS = 256;
const RGB_CHANNELS = 3;
const PALETTE_BYTES = PALETTE_COLORS * RGB_CHANNELS;
const PCX_PALETTE_MARKER = 12;
const PCX_MANUFACTURER = 10;
const PCX_INDEXED_BITS = 8;
const VERTEX_PALETTE_PATH = '/terrain-palettes/vertexcolors.pcx';

/** The 256 RGB entries in an indexed PCX trailer, independent of its image raster. */
export function vertexPaletteFromPcx(bytes: Uint8Array): readonly number[] | null {
  const start = bytes.length - PALETTE_BYTES;
  if (
    start <= PCX_HEADER_BYTES ||
    bytes[0] !== PCX_MANUFACTURER ||
    bytes[3] !== PCX_INDEXED_BITS ||
    bytes[65] !== 1 ||
    bytes[start - 1] !== PCX_PALETTE_MARKER
  )
    return null;
  const colors: number[] = [];
  for (let i = start; i < bytes.length; i += RGB_CHANNELS) {
    colors.push(((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0));
  }
  return colors;
}

export async function loadVertexPalette(): Promise<readonly number[] | null> {
  try {
    const response = await fetch(withBaseUrl(VERTEX_PALETTE_PATH));
    if (!response.ok) return null;
    const palette = vertexPaletteFromPcx(new Uint8Array(await response.arrayBuffer()));
    if (palette === null) diag.warn('content', 'Terrain vertex palette has no indexed PCX color table');
    return palette;
  } catch (error) {
    diag.warn('content', 'Terrain vertex palette unavailable', { error: String(error) });
    return null;
  }
}
