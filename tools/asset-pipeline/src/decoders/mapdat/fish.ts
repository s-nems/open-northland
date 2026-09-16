import type { MapFishSwarm } from '@open-northland/data';
import { viewOf } from '../byte-cursor.js';
import type { MapDatChunk } from './container.js';

const RECORD_SIZE = 12;
const VERSION_1_CAPACITY = 100;
const VERSION_2_CAPACITY = 500;

/** Decode populated slots from the fixed-size `lafm` fish-manager payload. */
export function decodeFishSwarms(chunk: MapDatChunk): MapFishSwarm[] {
  const capacity = chunk.version === 2 ? VERSION_2_CAPACITY : VERSION_1_CAPACITY;
  const expected = capacity * RECORD_SIZE + 4;
  if (chunk.length !== expected) {
    throw new Error(`mapdat: lafm v${chunk.version} payload is ${chunk.length} bytes, expected ${expected}`);
  }
  const view = viewOf(chunk.payload);
  const slots = view.getUint32(capacity * RECORD_SIZE, true);
  if (slots > capacity) {
    throw new Error(`mapdat: lafm declares ${slots} slots, capacity is ${capacity}`);
  }
  const swarms: MapFishSwarm[] = [];
  for (let i = 0; i < slots; i++) {
    const offset = i * RECORD_SIZE;
    const count = view.getUint32(offset + 4, true);
    if (count === 0) continue;
    if (count > 30) throw new Error(`mapdat: lafm slot ${i} has ${count} fish, maximum is 30`);
    swarms.push({
      hx: view.getUint16(offset, true),
      hy: view.getUint16(offset + 2, true),
      count,
      continent: view.getUint32(offset + 8, true),
    });
  }
  return swarms;
}
