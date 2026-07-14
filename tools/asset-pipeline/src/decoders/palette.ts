/**
 * Standalone `CPalette` decoder — the 256-color palette stored as its own storable (id 0x3F6) in
 * `.cif`/`.lib` object graphs (used by bobs and maps). This is not the `.pcx` trailing palette —
 * that one is RGB triples handled in `pcx.ts`; this one is the engine's native `[B,G,R,_]` table.
 *
 * Ported format (not architecture) from OpenVikings `Source/NXBasics/`:
 *   - CStorable.cs    on-disk object header: [u32 id][u32 version][body]
 *   - XBStorable.cs   factory: id 0x3F6 -> `new CPalette(file, version)`, read straight from the stream
 *   - CPalette.cs     body: a bare 0x400-byte blob = 256 entries × 4 bytes, layout [B, G, R, _]
 *                     (`CPalette(CFile, dataSize)` ignores `dataSize` and always reads 0x400; the 4th
 *                     byte of each entry is unused). `SetEntry`/`GetEntry` confirm the BGR_ order.
 * Referenced at OpenVikings_reversing @ working tree 2026-06.
 *
 * Unlike a `CStringArray`, the body is read raw (no CMemory wrapper, no encryption): the bytes after
 * the 8-byte header are the palette directly.
 *
 * Pure functions only (no I/O): `(bytes) => decoded`. The CLI wires file reads around them.
 * `encodePalette` is the faithful inverse, used to round-trip test without committing real assets.
 */

import { StorableId } from './cif.js';
import { assertPaletteBytes, PALETTE_RGB_BYTES } from './image.js';

const STORABLE_HEADER_BYTES = 8; // [u32 id][u32 version]
const ENTRY_COUNT = 256;
const BYTES_PER_ENTRY = 4; // on disk: [B, G, R, _]
const PALETTE_BODY_BYTES = ENTRY_COUNT * BYTES_PER_ENTRY; // 0x400

/** A decoded standalone palette: its storable version plus 256 colors as RGB triples. */
export interface Palette {
  /** Storable version word from the header (0 in observed game data); carried, not interpreted. */
  readonly version: number;
  /**
   * 256 RGB triples (768 bytes), row-major `[R, G, B] × 256`. Reordered from the on-disk `[B, G, R, _]`
   * so it drops straight into {@link import('./pcx.js').expandToRgba} like the `.pcx` trailer palette.
   */
  readonly rgb: Uint8Array;
}

/**
 * Decodes a standalone `CPalette` storable into 256 RGB triples. Throws a `palette:`-prefixed error on
 * a buffer too short for the header+body, or a header id that isn't 0x3F6 (a structurally wrong object
 * is a corrupt input — a batch pipeline should wrap the call per-file so one bad object can't abort the
 * run). Trailing bytes past the 0x400-byte body are ignored, matching the original's fixed-size read.
 */
export function decodePalette(bytes: Uint8Array): Palette {
  if (bytes.length < STORABLE_HEADER_BYTES + PALETTE_BODY_BYTES) {
    throw new Error(
      `palette: buffer of ${bytes.length} bytes is too short for the 8-byte header + ${PALETTE_BODY_BYTES}-byte body`,
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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

/** What {@link encodePalette} serializes: 256 RGB triples plus an optional storable version word. */
export interface PaletteInput {
  /** 256 RGB triples (768 bytes), `[R, G, B] × 256`. */
  readonly rgb: Uint8Array;
  /** Storable version word for the header. Defaults to 0 (as in observed game data). */
  readonly version?: number;
}

/**
 * Inverse of {@link decodePalette}: serializes the 8-byte storable header (id 0x3F6 + version) and the
 * 0x400-byte `[B, G, R, _]` body, reordering the RGB-triple input back to on-disk order with a zeroed
 * pad byte. Kept faithful so decode can be round-tripped without committing copyrighted fixtures (same
 * rationale as the `.lib`/`.cif`/`.pcx` encoder pairs). Throws on a palette that isn't 768 bytes.
 */
export function encodePalette(input: PaletteInput): Uint8Array {
  const { rgb, version = 0 } = input;
  assertPaletteBytes(rgb, 'palette', 'rgb');

  const out = new Uint8Array(STORABLE_HEADER_BYTES + PALETTE_BODY_BYTES);
  const view = new DataView(out.buffer);
  view.setUint32(0, StorableId.CPalette, true);
  view.setUint32(4, version, true);

  let dst = STORABLE_HEADER_BYTES;
  for (let i = 0; i < ENTRY_COUNT; i++) {
    const o = i * 3;
    out[dst] = rgb[o + 2] as number; // B
    out[dst + 1] = rgb[o + 1] as number; // G
    out[dst + 2] = rgb[o] as number; // R
    out[dst + 3] = 0; // pad
    dst += BYTES_PER_ENTRY;
  }

  return out;
}
