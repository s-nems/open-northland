import { type VertexPalette, VertexPalette as VertexPaletteSchema } from '@open-northland/data';
import { diag } from '../diag/index.js';
import { fetchJsonOrNull } from './net.js';

const VERTEX_PALETTE_URL = '/terrain-palettes/vertexcolors.json';

/** The palette a script's vertex colours index, or null without converted content. */
export async function loadVertexPalette(): Promise<VertexPalette | null> {
  const raw = await fetchJsonOrNull<unknown>(VERTEX_PALETTE_URL);
  if (raw === null) return null;
  const parsed = VertexPaletteSchema.safeParse(raw);
  if (!parsed.success) {
    diag.warn('content', `${VERTEX_PALETTE_URL} does not match this build; run the pipeline again`);
    return null;
  }
  return parsed.data;
}
