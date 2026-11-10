import { describe, expect, it } from 'vitest';
import { EMPTY_BLOCK, PAGE_BITS, PagedBlocks } from '../../src/ecs/paged-blocks.js';

const LOW_PAGE = 1 >>> PAGE_BITS;
const FAR_PAGE = 10_000_000 >>> PAGE_BITS;
const TOP_PAGE = 0x7fff0000 >>> PAGE_BITS;

describe('PagedBlocks', () => {
  it('holds far pages without sizing the dense table to them', () => {
    const capacities: number[] = [];
    const blocks = new PagedBlocks((capacity) => capacities.push(capacity));
    const low = blocks.acquire(LOW_PAGE);
    const far = blocks.acquire(FAR_PAGE);
    const top = blocks.acquire(TOP_PAGE);
    expect([low, far, top]).toEqual([1, 2, 3]);
    expect(blocks.pages).not.toBeInstanceOf(Int32Array);
    expect(capacities).toEqual([2, 4]);
    expect(blocks.blockOf(FAR_PAGE)).toBe(far);
    expect(blocks.blockOf(TOP_PAGE)).toBe(top);
    expect(blocks.blockOf(FAR_PAGE + 1)).toBe(EMPTY_BLOCK);
    const pages: number[] = [];
    blocks.forEachPage((page) => pages.push(page));
    expect(pages).toEqual([LOW_PAGE, FAR_PAGE, TOP_PAGE]);
  });

  it('frees a far page block for the next page, last freed first', () => {
    const blocks = new PagedBlocks(() => {});
    const top = blocks.acquire(TOP_PAGE);
    blocks.retain(top);
    blocks.release(TOP_PAGE, top);
    expect(blocks.blockOf(TOP_PAGE)).toBe(EMPTY_BLOCK);
    expect(blocks.acquire(LOW_PAGE)).toBe(top);
  });
});
