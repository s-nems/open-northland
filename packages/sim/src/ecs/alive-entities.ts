import { BIT_MASK, BITS_PER_WORD, WORD_SHIFT } from '../core/bit-words.js';
import type { Entity } from './component.js';

/** Entity ids below this are one bit each in a typed bitset; a higher id (only a crafted save can name
 *  one) turns the words into a sparse array, so a hostile id cannot size the bitset. */
const DENSE_ALIVE_LIMIT = 1 << 24;
const INITIAL_WORDS = 32;

// `bit` writes the bit-word constants as literals, which keeps it small enough to be inlined for free.
if (WORD_SHIFT !== 5 || BIT_MASK !== 31) {
  throw new Error('AliveEntities: the probe literals differ from the bit-word constants');
}

/** The alive entity ids: a membership probe reads one bit instead of hashing the id. */
export class AliveEntities {
  /** One bit per id. A word the bitset does not hold reads `undefined`, which shifts as 0. */
  private bits: Uint32Array | number[] = new Uint32Array(INITIAL_WORDS);
  private count = 0;

  get size(): number {
    return this.count;
  }

  has(entity: Entity): boolean {
    return this.bit(entity) !== 0;
  }

  /** 1 while `entity` is alive, else 0. */
  bit(entity: Entity): number {
    return ((this.bits[entity >>> 5] as number) >>> (entity & 31)) & 1;
  }

  add(entity: Entity): void {
    if (this.has(entity)) return;
    this.count++;
    const word = entity >>> WORD_SHIFT;
    if (word >= this.bits.length && this.bits instanceof Uint32Array)
      this.bits = grownBits(this.bits, entity);
    this.bits[word] = ((this.bits[word] ?? 0) | (1 << (entity & BIT_MASK))) >>> 0;
  }

  delete(entity: Entity): void {
    if (!this.has(entity)) return;
    this.count--;
    const word = entity >>> WORD_SHIFT;
    this.bits[word] = ((this.bits[word] ?? 0) & ~(1 << (entity & BIT_MASK))) >>> 0;
  }

  /** Every alive id, ascending. */
  ascending(): Entity[] {
    const out: Entity[] = [];
    const bits = this.bits;
    if (bits instanceof Uint32Array) {
      for (let word = 0; word < bits.length; word++) pushWord(out, word, bits[word] as number);
      return out;
    }
    // A sparse array lists its own indices ascending, where a walk to its length would not end.
    for (const key of Object.keys(bits)) pushWord(out, Number(key), bits[Number(key)] ?? 0);
    return out;
  }
}

/** Append the ids of `word`'s set bits, lowest first. */
function pushWord(out: Entity[], word: number, bits: number): void {
  let left = bits;
  while (left !== 0) {
    const lowest = left & -left;
    out.push(((word << WORD_SHIFT) + BITS_PER_WORD - 1 - Math.clz32(lowest)) as Entity);
    left ^= lowest;
  }
}

/** `bits` with room for `entity`: doubled while typed, a sparse array of the same words past the limit. */
function grownBits(bits: Uint32Array, entity: number): Uint32Array | number[] {
  if (entity >= DENSE_ALIVE_LIMIT) return Array.from(bits);
  let length = bits.length * 2;
  while (length <= entity >>> WORD_SHIFT) length *= 2;
  const grown = new Uint32Array(length);
  grown.set(bits);
  return grown;
}
