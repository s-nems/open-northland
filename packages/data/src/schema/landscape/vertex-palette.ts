import { z } from 'zod';

/** How many entries a `SetVertexColor` index addresses: the PCX colour table it comes from. */
export const VERTEX_PALETTE_ENTRIES = 256;

/** `terrain-palettes/vertexcolors.json`: the packed `0xRRGGBB` entries a script's vertex colour indexes. */
export const VertexPalette = z.array(z.number().int().min(0).max(0xffffff)).length(VERTEX_PALETTE_ENTRIES);
export type VertexPalette = z.infer<typeof VertexPalette>;
