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
/** Pages below this index a typed table (256 KB at most, ids below 4194304); a higher page, which only
 *  a crafted save or snapshot reaches, turns the table into a sparse array so its id cannot size it. */
const DENSE_PAGE_LIMIT = 1 << 16;
/** A typed table, or a sparse array once it holds a page past {@link DENSE_PAGE_LIMIT}. Both answer a
 *  keyed read, so a reader needs no test for which one it has. */
export type PageTable = Int32Array | number[];
const FIRST_BLOCK = EMPTY_BLOCK + 1;

/**
 * Hands out numbered blocks to the pages of the entity id space and counts the entities each block
 * holds; the owner keeps the per-block data in its own buffers, sized for {@link EMPTY_BLOCK} at first
 * and grown through `grow` to the new block capacity. A block whose count drops to zero is freed and
 * reused, last freed first.
 */
export class PagedBlocks {
  private table: PageTable = new Int32Array(0);
  private counts = new Int32Array(FIRST_BLOCK);
  private blockCount = FIRST_BLOCK;
  private readonly freeBlocks: number[] = [];

  constructor(private readonly grow: (capacity: number) => void) {}

  /** Each page's block: the table an owner reads on its own hot path, where a page it does not hold
   *  reads `undefined` or {@link EMPTY_BLOCK}, both 0 once shifted. {@link acquire} may replace it. */
  get pages(): PageTable {
    return this.table;
  }

  /** The block of `page`, or {@link EMPTY_BLOCK}. */
  blockOf(page: number): number {
    return this.table[page] ?? EMPTY_BLOCK;
  }

  /** The block of `page`, taking a free or new one when it has none. A taken block holds no entity yet. */
  acquire(page: number): number {
    const held = this.blockOf(page);
    if (held !== EMPTY_BLOCK) return held;
    const block = this.freeBlocks.pop() ?? this.newBlock();
    if (page >= this.table.length && this.table instanceof Int32Array)
      this.table = grownTable(this.table, page);
    this.table[page] = block;
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
    this.table[page] = EMPTY_BLOCK;
    this.freeBlocks.push(block);
  }

  /** Every page holding a block, ascending. */
  forEachPage(visit: (page: number, block: number) => void): void {
    const table = this.table;
    if (table instanceof Int32Array) {
      for (let page = 0; page < table.length; page++) {
        const block = table[page] as number;
        if (block !== EMPTY_BLOCK) visit(page, block);
      }
      return;
    }
    // A sparse array lists its own indices ascending, where a walk to its length would not end.
    for (const key of Object.keys(table)) {
      const page = Number(key);
      const block = table[page] ?? EMPTY_BLOCK;
      if (block !== EMPTY_BLOCK) visit(page, block);
    }
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

/** `table` with room for `page`: doubled while typed, a sparse array of the same blocks past the limit. */
function grownTable(table: Int32Array, page: number): PageTable {
  if (page >= DENSE_PAGE_LIMIT) return Array.from(table);
  const grown = new Int32Array(Math.min(DENSE_PAGE_LIMIT, Math.max(page + 1, table.length * 2)));
  grown.set(table);
  return grown;
}
