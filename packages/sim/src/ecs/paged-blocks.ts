/** Entity ids per page. A page takes a block only while it holds an entity, so ids in a few ranges keep
 *  the blocks few; an emptied block is reused by the next new page. Ids are never recycled, so a long
 *  game scatters entities over every page of the id space: a small page keeps the blocks those
 *  scattered entities take close to their own count. */
export const PAGE_BITS = 6;
export const PAGE_SIZE = 1 << PAGE_BITS;
export const PAGE_MASK = PAGE_SIZE - 1;
/** The block every page without one of its own reads. It never holds an entity, so an owner that leaves
 *  its data for this block zeroed answers a lookup on such a page without testing for the block. */
export const EMPTY_BLOCK = 0;
/** Pages below this index a dense table (256 KB at most, ids below 4194304); a higher page, which only
 *  a crafted save or snapshot reaches, falls back to a map so its id cannot size the table. */
const DENSE_PAGE_LIMIT = 1 << 16;
const FIRST_BLOCK = EMPTY_BLOCK + 1;

/**
 * Hands out numbered blocks to the pages of the entity id space and counts the entities each block
 * holds; the owner keeps the per-block data in its own buffers, sized for {@link EMPTY_BLOCK} at first
 * and grown through `grow` to the new block capacity. A block whose count drops to zero is freed and
 * reused, last freed first.
 */
export class PagedBlocks {
  private table = new Int32Array(0);
  private readonly sparse = new Map<number, number>();
  private counts = new Int32Array(FIRST_BLOCK);
  private blockCount = FIRST_BLOCK;
  private readonly freeBlocks: number[] = [];

  constructor(private readonly grow: (capacity: number) => void) {}

  /** Each dense page's block, {@link EMPTY_BLOCK} without one: the table an owner reads on its own hot
   *  path, sending a page past its length to {@link farBlockOf}. {@link acquire} may replace it. */
  get pages(): Int32Array {
    return this.table;
  }

  /** The block of `page`, or {@link EMPTY_BLOCK}. */
  blockOf(page: number): number {
    if (page < this.table.length) return this.table[page] as number;
    return this.farBlockOf(page);
  }

  /** {@link blockOf} for a page past the dense table. */
  farBlockOf(page: number): number {
    if (page < DENSE_PAGE_LIMIT) return EMPTY_BLOCK;
    return this.sparse.get(page) ?? EMPTY_BLOCK;
  }

  /** The block of `page`, taking a free or new one when it has none. A taken block holds no entity yet. */
  acquire(page: number): number {
    const held = this.blockOf(page);
    if (held !== EMPTY_BLOCK) return held;
    const block = this.freeBlocks.pop() ?? this.newBlock();
    if (page < DENSE_PAGE_LIMIT) {
      if (page >= this.table.length) {
        const table = new Int32Array(Math.min(DENSE_PAGE_LIMIT, Math.max(page + 1, this.table.length * 2)));
        table.set(this.table);
        this.table = table;
      }
      this.table[page] = block;
    } else {
      this.sparse.set(page, block);
    }
    return block;
  }

  /** `block` holds one more entity. */
  retain(block: number): void {
    this.counts[block] = (this.counts[block] as number) + 1;
  }

  /** `block`, the block of `page`, holds one entity less; the page loses it once it holds none. */
  release(page: number, block: number): void {
    const left = (this.counts[block] as number) - 1;
    this.counts[block] = left;
    if (left > 0) return;
    if (page < DENSE_PAGE_LIMIT) this.table[page] = EMPTY_BLOCK;
    else this.sparse.delete(page);
    this.freeBlocks.push(block);
  }

  /** Every page holding a block, ascending. */
  forEachPage(visit: (page: number, block: number) => void): void {
    for (let page = 0; page < this.table.length; page++) {
      const block = this.table[page] as number;
      if (block !== EMPTY_BLOCK) visit(page, block);
    }
    if (this.sparse.size === 0) return;
    for (const [page, block] of [...this.sparse].sort((a, b) => a[0] - b[0])) visit(page, block);
  }

  private newBlock(): number {
    const block = this.blockCount++;
    if (this.blockCount > this.counts.length) {
      const capacity = this.counts.length * 2;
      const counts = new Int32Array(capacity);
      counts.set(this.counts);
      this.counts = counts;
      this.grow(capacity);
    }
    return block;
  }
}
