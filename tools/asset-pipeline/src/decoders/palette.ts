/**
 * Standalone `CPalette` decoder: the 256-color palette stored as its own storable (id 0x3F6) in
 * `.cif`/`.lib` object graphs, not the `.pcx` trailing palette handled in `pcx.ts`.
 *
 * Byte-level inspection of an owned copy establishes the layout: an 8-byte storable header then a
 * 0x400-byte body of 256 `[B, G, R, unused]` entries, read raw with no CMemory wrapper or encryption.
 */

import { viewOf } from './byte-cursor.js';
import { assertPaletteBytes, PALETTE_RGB_BYTES, writeBgraTable } from './image.js';
import { StorableId } from './storable.js';

const STORABLE_HEADER_BYTES = 8; // [u32 id][u32 version]
const ENTRY_COUNT = 256;
const BYTES_PER_ENTRY = 4; // on disk: [B, G, R, _]
const PALETTE_BODY_BYTES = ENTRY_COUNT * BYTES_PER_ENTRY; // 0x400

export interface Palette {
  /** Storable version word from the header, 0 in observed game data. */
  readonly version: number;
  /** 256 RGB triples (768 bytes), reordered from the on-disk `[B, G, R, _]` entries. */
  readonly rgb: Uint8Array;
}

/**
 * Decodes a standalone `CPalette` storable into 256 RGB triples. Throws on a buffer too short for the
 * header and body, or a header id that isn't 0x3F6. Trailing bytes past the 0x400-byte body are
 * ignored, matching the original's fixed-size read.
 */
export function decodePalette(bytes: Uint8Array): Palette {
  if (bytes.length < STORABLE_HEADER_BYTES + PALETTE_BODY_BYTES) {
    throw new Error(
      `palette: buffer of ${bytes.length} bytes is too short for the 8-byte header + ${PALETTE_BODY_BYTES}-byte body`,
    );
  }

  const view = viewOf(bytes);
  const id = view.getUint32(0, true);
  if (id !== StorableId.CPalette) {
    throw new Error(`palette: storable id is not CPalette (0x3F6); got 0x${id.toString(16)}`);
  }
  const version = view.getUint32(4, true);

  const rgb = new Uint8Array(PALETTE_RGB_BYTES);
  let src = STORABLE_HEADER_BYTES;
  for (let i = 0; i < ENTRY_COUNT; i++) {
    const b = bytes[src] as number;
    const g = bytes[src + 1] as number;
    const r = bytes[src + 2] as number;
    // 4th byte (src + 3) is unused padding in the original layout.
    const o = i * 3;
    rgb[o] = r;
    rgb[o + 1] = g;
    rgb[o + 2] = b;
    src += BYTES_PER_ENTRY;
  }

  return { version, rgb };
}

export interface PaletteInput {
  /** 256 RGB triples (768 bytes). */
  readonly rgb: Uint8Array;
  /** Storable version word for the header, 0 in observed game data. */
  readonly version?: number;
}

/**
 * Inverse of {@link decodePalette}: writes the 8-byte storable header and the 0x400-byte `[B, G, R, _]`
 * body, reordering the RGB triples back to on-disk order with a zeroed pad byte. Kept faithful so decode
 * can be round-tripped without committing copyrighted fixtures. Throws on a palette that isn't 768 bytes.
 */
export function encodePalette(input: PaletteInput): Uint8Array {
  const { rgb, version = 0 } = input;
  assertPaletteBytes(rgb, 'palette', 'rgb');

  const out = new Uint8Array(STORABLE_HEADER_BYTES + PALETTE_BODY_BYTES);
  const view = new DataView(out.buffer);
  view.setUint32(0, StorableId.CPalette, true);
  view.setUint32(4, version, true);

  writeBgraTable(out, STORABLE_HEADER_BYTES, rgb);

  return out;
}
