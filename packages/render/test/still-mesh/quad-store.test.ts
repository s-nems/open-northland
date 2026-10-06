import type { Buffer } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { QUAD_FLOATS, QuadStore } from '../../src/gpu/still-mesh/quad-store.js';

const QUAD_BYTES = QUAD_FLOATS * Float32Array.BYTES_PER_ELEMENT;

/** The byte ranges a flush uploads, as [first quad, quads]. */
function flushed(store: QuadStore): [number, number][] {
  const ranges: [number, number][] = [];
  store.flush((_buffer: Buffer, offset, size) => ranges.push([offset / QUAD_BYTES, size / QUAD_BYTES]));
  return ranges;
}

describe('QuadStore', () => {
  it('reuses the most recently released slot before growing', () => {
    const store = new QuadStore(4);
    const slots = [store.allocate(), store.allocate(), store.allocate()];
    store.release(slots[1] ?? -1);
    expect(store.allocate()).toBe(slots[1]);
    expect(store.size).toBe(3);
  });

  it('grows keeping every packed quad, and uploads all of it once', () => {
    const store = new QuadStore(2);
    const first = store.allocate();
    store.f32[QuadStore.start(first)] = 7;
    store.allocate();
    store.allocate();
    expect(store.capacity).toBe(4);
    expect(store.f32[QuadStore.start(first)]).toBe(7);
    expect(store.buffer.data).toBe(store.f32);
    store.markDirty(first);
    expect(flushed(store)).toEqual([[0, 4]]);
    expect(flushed(store)).toEqual([]);
  });

  it('merges nearby dirty slots into one range and keeps distant ones apart', () => {
    const store = new QuadStore(64);
    for (let i = 0; i < 64; i++) store.allocate();
    flushed(store);
    for (const slot of [3, 5, 4, 40]) store.markDirty(slot);
    expect(flushed(store)).toEqual([
      [3, 3],
      [40, 1],
    ]);
  });

  it('uploads the union once the ranges grow too many', () => {
    const quads = 512;
    const store = new QuadStore(quads);
    for (let i = 0; i < quads; i++) store.allocate();
    flushed(store);
    for (let slot = 0; slot < quads; slot += 20) store.markDirty(slot);
    expect(flushed(store)).toEqual([[0, 501]]);
  });
});
