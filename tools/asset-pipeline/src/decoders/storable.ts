/**
 * The storable-object vocabulary Cultures containers share: the class ids the original's factory
 * dispatches on, and the `CMemory` blob wrapper they nest payloads in. Format-neutral, so no decoder
 * depends on a sibling format's module for it.
 *
 * Source basis: each id is the leading `u32` observed on its container in an owned copy; the decoders
 * assert them per-format and synthetic round-trip fixtures pin the layouts.
 */

import type { ByteCursor } from './byte-cursor.js';

/** `CBitmap` and `CRemapTable` have no reader yet; they record the observed id space. */
export const StorableId = {
  CMemory: 0x3e9,
  CBitmap: 0x3f3,
  CBobManager: 0x3f4,
  CFont: 0x3f5,
  CPalette: 0x3f6,
  CRemapTable: 0x3f7,
  CStringArray: 0x3fd,
} as const;

/**
 * Reads one `CMemory` body (`[u32 id=0x3E9][u32 version][u32 size][size bytes]`), returning a copy so
 * the caller may decrypt in place without touching the source buffer. Asserts the id, tagging the
 * error with the cursor's format prefix.
 */
export function readCMemory(r: ByteCursor): Uint8Array {
  const id = r.u32();
  r.u32(); // version (unused)
  if (id !== StorableId.CMemory) {
    throw new Error(`${r.prefix}: expected CMemory (0x3E9), got storable id 0x${id.toString(16)}`);
  }
  const size = r.u32();
  return Uint8Array.from(r.take(size));
}
