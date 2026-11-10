import { BIT_MASK, WORD_SHIFT } from '../core/bit-words.js';
import type { Entity } from './component.js';
import { EMPTY_BLOCK, PAGE_BITS, PAGE_MASK, PAGE_SIZE, PagedBlocks } from './paged-blocks.js';

const NOT_CARRIED = -1;

/**
 * Per entity, the registration indices of the components it carries, one bit each, so walking them in
 * ascending index order is walking them in registration order. The masks of all entities share one
 * paged buffer instead of a list object per entity, `stride` words per entity, widened when a component
 * registers past the bits it holds.
 */
export class EntityMemberships {
  private stride = 1;
  /** A page holds a block of masks while one of its entities carries a component; a block counts those
   *  entities. */
  private readonly blocks = new PagedBlocks((capacity) => this.growBlocks(capacity));
  /** {@link PAGE_SIZE} masks of {@link stride} words per block. */
  private masks = new Uint32Array(PAGE_SIZE);

  add(entity: Entity, index: number): void {
    const word = index >>> WORD_SHIFT;
    if (word >= this.stride) this.widen(word + 1);
    const block = this.blocks.acquire(entity >>> PAGE_BITS);
    const at = ((block << PAGE_BITS) | (entity & PAGE_MASK)) * this.stride;
    if (this.isEmpty(at)) this.blocks.retain(block);
    this.masks[at + word] = (this.masks[at + word] as number) | (1 << (index & BIT_MASK));
  }

  remove(entity: Entity, index: number): void {
    const at = this.maskOf(entity);
    const word = index >>> WORD_SHIFT;
    if (at === NOT_CARRIED || word >= this.stride) return;
    const bit = 1 << (index & BIT_MASK);
    const mask = this.masks[at + word] as number;
    if ((mask & bit) === 0) return;
    this.masks[at + word] = mask & ~bit;
    if (this.isEmpty(at)) this.release(entity);
  }

  /** Forget every component `entity` carries. */
  clear(entity: Entity): void {
    const at = this.maskOf(entity);
    if (at === NOT_CARRIED || this.isEmpty(at)) return;
    this.masks.fill(0, at, at + this.stride);
    this.release(entity);
  }

  has(entity: Entity, index: number): boolean {
    const at = this.maskOf(entity);
    const word = index >>> WORD_SHIFT;
    if (at === NOT_CARRIED || word >= this.stride) return false;
    return ((this.masks[at + word] as number) & (1 << (index & BIT_MASK))) !== 0;
  }

  /** The lowest index above `after` that `entity` carries, or -1: start from -1 and pass each answer
   *  back to walk the entity's components in registration order without allocating. */
  next(entity: Entity, after: number): number {
    const at = this.maskOf(entity);
    if (at === NOT_CARRIED) return NOT_CARRIED;
    const start = after + 1;
    let word = start >>> WORD_SHIFT;
    if (word >= this.stride) return NOT_CARRIED;
    let bits = (this.masks[at + word] as number) & (~0 << (start & BIT_MASK));
    for (;;) {
      if (bits !== 0) return (word << WORD_SHIFT) + BIT_MASK - Math.clz32(bits & -bits);
      word++;
      if (word >= this.stride) return NOT_CARRIED;
      bits = this.masks[at + word] as number;
    }
  }

  /** Every carried (entity, index) pair, for the cache verifier. */
  forEachCarried(visit: (entity: Entity, index: number) => void): void {
    this.blocks.forEachPage((page) => {
      for (let offset = 0; offset < PAGE_SIZE; offset++) {
        const entity = ((page << PAGE_BITS) | offset) as Entity;
        for (let index = this.next(entity, -1); index >= 0; index = this.next(entity, index)) {
          visit(entity, index);
        }
      }
    });
  }

  /** The first mask word of `entity`, or {@link NOT_CARRIED} while its page holds no block. */
  private maskOf(entity: Entity): number {
    const block = this.blocks.blockOf(entity >>> PAGE_BITS);
    if (block === EMPTY_BLOCK) return NOT_CARRIED;
    return ((block << PAGE_BITS) | (entity & PAGE_MASK)) * this.stride;
  }

  private isEmpty(at: number): boolean {
    for (let w = 0; w < this.stride; w++) if (this.masks[at + w] !== 0) return false;
    return true;
  }

  /** `entity` carries nothing any more: its block loses an entity, and an emptied block is freed. */
  private release(entity: Entity): void {
    const page = entity >>> PAGE_BITS;
    this.blocks.release(page, this.blocks.blockOf(page));
  }

  private growBlocks(capacity: number): void {
    const masks = new Uint32Array(capacity * PAGE_SIZE * this.stride);
    masks.set(this.masks);
    this.masks = masks;
  }

  /** Re-lay every mask at `stride` words, keeping its bits. */
  private widen(stride: number): void {
    const from = this.masks;
    const old = this.stride;
    const slots = from.length / old;
    const masks = new Uint32Array(slots * stride);
    for (let slot = 0; slot < slots; slot++) {
      for (let w = 0; w < old; w++) masks[slot * stride + w] = from[slot * old + w] as number;
    }
    this.masks = masks;
    this.stride = stride;
  }
}
