import type { TerrainGraph } from '../../../../nav/terrain/index.js';

/** Marks an empty list head or the end of a node's list; slots are stored one-based. */
const NO_SLOT = 0;

/**
 * Collider slots grouped by half-cell node, rebuilt every tick: a list head per terrain node plus one link
 * per slot, so a lookup is two array reads where a keyed bucket map hashed every probe. Each node's list is
 * ascending by slot. A slot whose node lies off the lattice goes to an overflow list scanned in slot order,
 * so an off-map body still meets its neighbours as a bucketed one would.
 */
export class SlotGrid {
  private terrain: TerrainGraph | undefined;
  private width = 0;
  private height = 0;
  private head = new Int32Array(0);
  private next = new Int32Array(0);
  /** The node each slot of the current fill was listed on, or -1 for an overflow slot. */
  private nodeOf = new Int32Array(0);
  private filled = 0;
  private readonly overflow: number[] = [];
  private overflowCount = 0;
  private overflowHx: readonly number[] = [];
  private overflowHy: readonly number[] = [];

  /** List slots `0..count-1` on node `(hx[slot], hy[slot])`. */
  fill(terrain: TerrainGraph, count: number, hx: readonly number[], hy: readonly number[]): void {
    this.clear(terrain);
    if (this.next.length < count) {
      const size = Math.max(count, this.next.length * 2);
      this.next = new Int32Array(size);
      this.nodeOf = new Int32Array(size);
    }
    // Descending head insertion leaves every node's list ascending.
    for (let slot = count - 1; slot >= 0; slot--) {
      const x = hx[slot] ?? 0;
      const y = hy[slot] ?? 0;
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
        this.nodeOf[slot] = -1;
        continue;
      }
      const node = y * this.width + x;
      this.nodeOf[slot] = node;
      this.next[slot] = this.head[node] ?? NO_SLOT;
      this.head[node] = slot + 1;
    }
    this.overflowCount = 0;
    for (let slot = 0; slot < count; slot++) {
      if (this.nodeOf[slot] === -1) this.overflow[this.overflowCount++] = slot;
    }
    this.overflowHx = hx;
    this.overflowHy = hy;
    this.filled = count;
  }

  /** Append node `(x, y)`'s slots to `out` from index `at`, ascending, and return the new count. */
  collect(x: number, y: number, out: number[], at: number): number {
    let count = at;
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) {
      for (let s = this.head[y * this.width + x] ?? NO_SLOT; s !== NO_SLOT; s = this.next[s - 1] ?? NO_SLOT) {
        out[count++] = s - 1;
      }
      return count;
    }
    for (let i = 0; i < this.overflowCount; i++) {
      const slot = this.overflow[i] ?? 0;
      if (this.overflowHx[slot] === x && this.overflowHy[slot] === y) out[count++] = slot;
    }
    return count;
  }

  /** Empty the previous fill's lists, re-sizing the heads when the terrain changed. */
  private clear(terrain: TerrainGraph): void {
    if (terrain !== this.terrain) {
      this.terrain = terrain;
      this.width = terrain.width;
      this.height = terrain.height;
      this.head = new Int32Array(terrain.nodeCount);
      this.filled = 0;
      return;
    }
    for (let slot = 0; slot < this.filled; slot++) {
      const node = this.nodeOf[slot] ?? -1;
      if (node >= 0) this.head[node] = NO_SLOT;
    }
  }
}
