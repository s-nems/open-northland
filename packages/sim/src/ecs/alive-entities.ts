import { BIT_MASK, BITS_PER_WORD, WORD_SHIFT } from '../core/bit-words.js';
import type { Entity } from './component.js';

/** Entity ids below this are one bit each in a bitset; a higher id (only a crafted save can name one)
 *  falls back to a set, so a hostile id cannot size the bitset. */
const DENSE_ALIVE_LIMIT = 1 << 24;
const INITIAL_WORDS = 32;

/** The alive entity ids: a membership probe reads one bit instead of hashing the id. */
export class AliveEntities {
  private bits = new Uint32Array(INITIAL_WORDS);
  private readonly far = new Set<Entity>();
  private count = 0;

  get size(): number {
    return this.count;
  }

  has(entity: Entity): boolean {
    const word = entity >>> WORD_SHIFT;
    const bits = this.bits;
    if (word < bits.length) return ((bits[word] as number) & (1 << (entity & BIT_MASK))) !== 0;
    return this.far.has(entity);
  }

  add(entity: Entity): void {
    if (this.has(entity)) return;
    this.count++;
    if (entity < 0 || entity >= DENSE_ALIVE_LIMIT) {
      this.far.add(entity);
      return;
    }
    const word = entity >>> WORD_SHIFT;
    if (word >= this.bits.length) this.grow(word);
    this.bits[word] = (this.bits[word] as number) | (1 << (entity & BIT_MASK));
  }

  delete(entity: Entity): void {
    if (!this.has(entity)) return;
    this.count--;
    const word = entity >>> WORD_SHIFT;
    if (word < this.bits.length) this.bits[word] = (this.bits[word] as number) & ~(1 << (entity & BIT_MASK));
    else this.far.delete(entity);
  }

  /** Every alive id, ascending. */
  ascending(): Entity[] {
    const out: Entity[] = [];
    const bits = this.bits;
    for (let word = 0; word < bits.length; word++) {
      let left = bits[word] as number;
      while (left !== 0) {
        const lowest = left & -left;
        out.push(((word << WORD_SHIFT) + BITS_PER_WORD - 1 - Math.clz32(lowest)) as Entity);
        left ^= lowest;
      }
    }
    // Every far id is above every dense one.
    if (this.far.size > 0) out.push(...[...this.far].sort((a, b) => a - b));
    return out;
  }

  private grow(word: number): void {
    let length = this.bits.length * 2;
    while (length <= word) length *= 2;
    const grown = new Uint32Array(length);
    grown.set(this.bits);
    this.bits = grown;
  }
}
