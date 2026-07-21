import { encryptMode1 } from '../../src/decoders/cif.js';
import { StorableId } from '../../src/decoders/storable.js';

/**
 * Serializes level-tagged lines into a `CStringArray` byte stream using the decoder's inverse cipher,
 * so the map/gui stages can be exercised end-to-end without committing a
 * copyrighted fixture. Kept local to the tests rather than exported from the decoder, which only
 * needs to decode.
 */
export const buildStringCif = (lines: readonly { level: number; text: string }[]): Uint8Array => {
  const chunks: number[] = [];
  const offsetValues: number[] = [];
  for (const { level, text } of lines) {
    offsetValues.push(chunks.length);
    if (level > 0) chunks.push(level);
    for (const ch of text) chunks.push(ch.charCodeAt(0) & 0xff);
    chunks.push(0);
  }
  const pool = Uint8Array.from(chunks);
  const offsets = new Uint8Array(offsetValues.length * 4);
  const ov = new DataView(offsets.buffer);
  offsetValues.forEach((v, i) => {
    ov.setUint32(i * 4, v, true);
  });
  encryptMode1(offsets);
  encryptMode1(pool);

  const out: number[] = [];
  const pushU32 = (v: number): void =>
    void out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  const pushCMemory = (data: Uint8Array): void => {
    pushU32(StorableId.CMemory);
    pushU32(0);
    pushU32(data.length);
    for (const b of data) out.push(b);
  };
  pushU32(StorableId.CStringArray);
  pushU32(0);
  pushU32(1); // forceSequentialIds
  pushU32(lines.length); // stringCount
  pushU32(lines.length); // usedIdCount
  pushU32(lines.length); // slotCount
  pushU32(pool.length); // stringPoolUsedBytes
  pushCMemory(offsets);
  out.push(1); // hasStringPool
  pushCMemory(pool);
  return Uint8Array.from(out);
};

/** A minimal campaign-map logic header: mapsize/mapguid + maptype/mapname metadata. */
export const sampleMapLines = (): { level: number; text: string }[] => [
  { level: 1, text: 'logiccontrol' },
  { level: 2, text: 'mapsize 142 146' },
  { level: 2, text: 'mapguid 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16' },
  { level: 1, text: 'logiccontrolend' },
  { level: 1, text: 'misc_maptype' },
  { level: 2, text: 'maptype 1' },
  { level: 2, text: 'mapcampaignid 100 2' },
];
