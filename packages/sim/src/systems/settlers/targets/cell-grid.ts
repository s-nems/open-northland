import { indexAboveId, insertSortedById, removeSortedById } from '../../../core/sorted-id.js';
import type { Entity } from '../../../ecs/world.js';
import type { NodeBox } from '../../../nav/node-circle.js';

/** Candidate counts per coordinate along one axis, so the span tightens once an edge coordinate empties. */
class AxisSpan {
  private readonly counts = new Map<number, number>();
  min = Number.POSITIVE_INFINITY;
  max = Number.NEGATIVE_INFINITY;

  add(v: number): void {
    this.counts.set(v, (this.counts.get(v) ?? 0) + 1);
    if (v < this.min) this.min = v;
    if (v > this.max) this.max = v;
  }

  remove(v: number): void {
    const left = (this.counts.get(v) ?? 1) - 1;
    if (left > 0) {
      this.counts.set(v, left);
      return;
    }
    this.counts.delete(v);
    if (v !== this.min && v !== this.max) return;
    this.min = Number.POSITIVE_INFINITY;
    this.max = Number.NEGATIVE_INFINITY;
    for (const held of this.counts.keys()) {
      if (held < this.min) this.min = held;
      if (held > this.max) this.max = held;
    }
  }
}

/** Nodes per side of a {@link CellGrid} tile, a power of two. */
const TILE_SHIFT = 3;
const TILE_SIZE = 1 << TILE_SHIFT;
/** Nodes per side of a {@link CellGrid} block, the coarse level a search past the ring cap walks: eight
 *  tiles, a power of two. */
const BLOCK_SHIFT = TILE_SHIFT + 3;
const BLOCK_SIZE = 1 << BLOCK_SHIFT;
/** Packs a node or a tile into one key; coordinates stay below it on every map. */
const GRID_KEY_STRIDE = 1 << 16;

/** Packs a ranked list entry's distance above its insertion index; every index stays below it. */
const RANK_INDEX_SPAN = 2 ** 24;
const INITIAL_RANK_KEYS = 64;
/** Lists at most this long sort by insertion in place; longer ones through a typed-array view. */
const INSERTION_SORT_MAX = 32;

/** Lists ranked by a least distance, ties in insertion order, reused across searches. */
class RankedLists<T> {
  private readonly items: (T | undefined)[] = [];
  private keys = new Float64Array(INITIAL_RANK_KEYS);
  private size = 0;

  /** Entries pushed since the last {@link reset}; after {@link sort} their keys run ascending. */
  get count(): number {
    return this.size;
  }

  /** Empty the lists, dropping the items so the module scratch does not pin a finished world's grid. */
  reset(): void {
    this.items.fill(undefined, 0, this.size);
    this.size = 0;
  }

  push(item: T, distance: number): void {
    if (this.size === this.keys.length) {
      const grown = new Float64Array(this.keys.length * 2);
      grown.set(this.keys);
      this.keys = grown;
    }
    this.items[this.size] = item;
    this.keys[this.size] = distance * RANK_INDEX_SPAN + this.size;
    this.size++;
  }

  /** Sort the keys in place: a short run by insertion, which needs no view of the backing store. Keys are
   *  distinct, so both sorts give the one ascending order. */
  sort(): void {
    const { keys, size: count } = this;
    if (count > INSERTION_SORT_MAX) {
      keys.subarray(0, count).sort();
      return;
    }
    for (let i = 1; i < count; i++) {
      const key = keys[i] as number;
      let j = i - 1;
      while (j >= 0 && (keys[j] as number) > key) {
        keys[j + 1] = keys[j] as number;
        j--;
      }
      keys[j + 1] = key;
    }
  }

  /** The `i`th key in ascending order after {@link sort}. */
  keyAt(i: number): number {
    return this.keys[i] as number;
  }

  itemOf(key: number): T {
    return this.items[key % RANK_INDEX_SPAN] as T;
  }
}

function rankDistanceOf(key: number): number {
  return Math.floor(key / RANK_INDEX_SPAN);
}

/** Scratch per search depth, since a visit may search a grid again. */
const tileLists: RankedLists<readonly GridNode[]>[] = [];
const blockLists: RankedLists<readonly number[]>[] = [];
let searchDepth = 0;

/** An occupied node: its packed key and its candidates, ascending-id. */
interface GridNode {
  readonly key: number;
  readonly entities: Entity[];
}

/** Candidates bucketed by node coordinates, with the span of the occupied nodes so a search never
 *  expands past the farthest bucket, the occupied nodes of each square tile so a search reads only
 *  occupied nodes, nearest tiles first, and the occupied tiles of each block for a search past the ring
 *  cap. */
export class CellGrid {
  private readonly xs = new AxisSpan();
  private readonly ys = new AxisSpan();
  /** Each tile's occupied nodes, ascending by key. */
  private readonly tiles = new Map<number, GridNode[]>();
  /** Each block's occupied tiles as packed keys, ascending. */
  private readonly blocks = new Map<number, number[]>();
  /** Occupied nodes. */
  size = 0;

  add(e: Entity, x: number, y: number): void {
    const tile = (x >> TILE_SHIFT) * GRID_KEY_STRIDE + (y >> TILE_SHIFT);
    const key = x * GRID_KEY_STRIDE + y;
    const nodes = this.tiles.get(tile);
    if (nodes === undefined) {
      // Most tiles hold one node and most blocks one tile: a literal is sized for its one item, where a
      // push onto an empty array reserves room for seventeen.
      this.tiles.set(tile, [{ key, entities: [e] }]);
      this.size++;
      const block = (x >> BLOCK_SHIFT) * GRID_KEY_STRIDE + (y >> BLOCK_SHIFT);
      const tiles = this.blocks.get(block);
      if (tiles === undefined) this.blocks.set(block, [tile]);
      else insertSortedById(tiles, tile, tileKey);
    } else {
      const at = nodes[indexAboveId(nodes, key - 1, nodeKeyOf)];
      if (at?.key === key) insertSortedById(at.entities, e, entityId);
      else {
        insertSortedById(nodes, { key, entities: [e] }, nodeKeyOf);
        this.size++;
      }
    }
    this.xs.add(x);
    this.ys.add(y);
  }

  /** Drop `e`, which {@link add} placed at `(x,y)`. */
  remove(e: Entity, x: number, y: number): void {
    const tile = (x >> TILE_SHIFT) * GRID_KEY_STRIDE + (y >> TILE_SHIFT);
    const nodes = this.tiles.get(tile);
    const key = x * GRID_KEY_STRIDE + y;
    const at = nodes?.[indexAboveId(nodes, key - 1, nodeKeyOf)];
    if (nodes !== undefined && at?.key === key) {
      removeSortedById(at.entities, e, entityId);
      if (at.entities.length === 0) {
        removeSortedById(nodes, key, nodeKeyOf);
        this.size--;
        if (nodes.length === 0) {
          this.tiles.delete(tile);
          const block = (x >> BLOCK_SHIFT) * GRID_KEY_STRIDE + (y >> BLOCK_SHIFT);
          const tiles = this.blocks.get(block);
          if (tiles !== undefined) {
            removeSortedById(tiles, tile, tileKey);
            if (tiles.length === 0) this.blocks.delete(block);
          }
        }
      }
    }
    this.xs.remove(x);
    this.ys.remove(y);
  }

  /**
   * Hand `visit` every occupied node within Manhattan `maxRadius` of `(x,y)` with its distance and bucket,
   * tile by tile in order of each tile's least distance. `visit` returns the distance past which no node
   * can still win; the search stops once every node left lies more than `slack` past it.
   */
  nearestFirst(
    x: number,
    y: number,
    maxRadius: number,
    slack: number,
    visit: (nx: number, ny: number, distance: number, bucket: readonly Entity[]) => number,
  ): void {
    const depth = searchDepth++;
    try {
      this.nearestFirstAt(depth, x, y, maxRadius, slack, visit);
    } finally {
      tileLists[depth]?.reset();
      searchDepth--;
    }
  }

  private nearestFirstAt(
    depth: number,
    x: number,
    y: number,
    maxRadius: number,
    slack: number,
    visit: (nx: number, ny: number, distance: number, bucket: readonly Entity[]) => number,
  ): void {
    tileLists[depth] ??= new RankedLists();
    const tiles = tileLists[depth];
    tiles.reset();
    const minTx = Math.max(0, x - maxRadius) >> TILE_SHIFT;
    const maxTx = (x + maxRadius) >> TILE_SHIFT;
    const minTy = Math.max(0, y - maxRadius) >> TILE_SHIFT;
    const maxTy = (y + maxRadius) >> TILE_SHIFT;
    for (let tx = minTx; tx <= maxTx; tx++) {
      const dx = Math.max(0, tx * TILE_SIZE - x, x - (tx * TILE_SIZE + TILE_SIZE - 1));
      for (let ty = minTy; ty <= maxTy; ty++) {
        const nodes = this.tiles.get(tx * GRID_KEY_STRIDE + ty);
        if (nodes === undefined) continue;
        const least = dx + Math.max(0, ty * TILE_SIZE - y, y - (ty * TILE_SIZE + TILE_SIZE - 1));
        if (least > maxRadius) continue;
        tiles.push(nodes, least);
      }
    }
    tiles.sort();
    let bound = Number.POSITIVE_INFINITY;
    for (let i = 0; i < tiles.count; i++) {
      const key = tiles.keyAt(i);
      if (rankDistanceOf(key) - slack > bound) return;
      for (const node of tiles.itemOf(key)) {
        const nx = Math.floor(node.key / GRID_KEY_STRIDE);
        const ny = node.key - nx * GRID_KEY_STRIDE;
        const distance = Math.abs(nx - x) + Math.abs(ny - y);
        if (distance > maxRadius || distance - slack > bound) continue;
        bound = visit(nx, ny, distance, node.entities);
      }
    }
  }

  /**
   * {@link nearestFirst} for the occupied nodes past Manhattan `near` and within `maxRadius` of `(x,y)`,
   * block by block in order of each block's least distance, skipping a block that misses `box`, the node
   * box a winner must lie within `slack` of. `bound` is the distance a winner found before already holds.
   */
  farFirst(
    x: number,
    y: number,
    near: number,
    maxRadius: number,
    slack: number,
    box: NodeBox | undefined,
    bound: number,
    visit: (nx: number, ny: number, distance: number, bucket: readonly Entity[]) => number,
  ): void {
    const depth = searchDepth++;
    try {
      this.farFirstAt(depth, x, y, near, maxRadius, slack, box, bound, visit);
    } finally {
      blockLists[depth]?.reset();
      tileLists[depth]?.reset();
      searchDepth--;
    }
  }

  private farFirstAt(
    depth: number,
    x: number,
    y: number,
    near: number,
    maxRadius: number,
    slack: number,
    box: NodeBox | undefined,
    bound: number,
    visit: (nx: number, ny: number, distance: number, bucket: readonly Entity[]) => number,
  ): void {
    blockLists[depth] ??= new RankedLists();
    tileLists[depth] ??= new RankedLists();
    const blocks = blockLists[depth];
    const ranked = tileLists[depth];
    blocks.reset();
    // forEach, since a `for...of` over the map allocates an entry pair and an iterator result per block.
    this.blocks.forEach((tiles, key) => {
      const bx = Math.floor(key / GRID_KEY_STRIDE);
      const by = key - bx * GRID_KEY_STRIDE;
      const minX = bx << BLOCK_SHIFT;
      const minY = by << BLOCK_SHIFT;
      const least = spanGap(x, minX, BLOCK_SIZE) + spanGap(y, minY, BLOCK_SIZE);
      if (least > maxRadius || least - slack > bound) return;
      if (box !== undefined && !squareNearBox(box, minX, minY, BLOCK_SIZE, slack)) return;
      blocks.push(tiles, least);
    });
    blocks.sort();
    for (let i = 0; i < blocks.count; i++) {
      const blockKey = blocks.keyAt(i);
      if (rankDistanceOf(blockKey) - slack > bound) return;
      ranked.reset();
      for (const tile of blocks.itemOf(blockKey)) {
        const tx = Math.floor(tile / GRID_KEY_STRIDE);
        const ty = tile - tx * GRID_KEY_STRIDE;
        const minX = tx << TILE_SHIFT;
        const minY = ty << TILE_SHIFT;
        const least = spanGap(x, minX, TILE_SIZE) + spanGap(y, minY, TILE_SIZE);
        if (least > maxRadius || least - slack > bound) continue;
        if (spanReach(x, minX, TILE_SIZE) + spanReach(y, minY, TILE_SIZE) <= near) continue;
        const nodes = this.tiles.get(tile);
        if (nodes === undefined) continue; // a block lists only occupied tiles
        ranked.push(nodes, least);
      }
      ranked.sort();
      for (let j = 0; j < ranked.count; j++) {
        const rankedKey = ranked.keyAt(j);
        if (rankDistanceOf(rankedKey) - slack > bound) break;
        for (const node of ranked.itemOf(rankedKey)) {
          const nx = Math.floor(node.key / GRID_KEY_STRIDE);
          const ny = node.key - nx * GRID_KEY_STRIDE;
          const distance = Math.abs(nx - x) + Math.abs(ny - y);
          if (distance <= near || distance > maxRadius || distance - slack > bound) continue;
          bound = visit(nx, ny, distance, node.entities);
        }
      }
    }
  }

  /** Hand `visit` every candidate on an occupied node inside `box`, block by block and tile by tile, so the
   *  walk costs the box's occupied blocks and tiles, never its nodes. */
  forEachIn(box: NodeBox, visit: (e: Entity, x: number, y: number) => void): void {
    const minBx = Math.max(0, box.minX) >> BLOCK_SHIFT;
    const maxBx = Math.max(0, box.maxX) >> BLOCK_SHIFT;
    const minBy = Math.max(0, box.minY) >> BLOCK_SHIFT;
    const maxBy = Math.max(0, box.maxY) >> BLOCK_SHIFT;
    for (let bx = minBx; bx <= maxBx; bx++) {
      for (let by = minBy; by <= maxBy; by++) {
        const tiles = this.blocks.get(bx * GRID_KEY_STRIDE + by);
        if (tiles === undefined) continue;
        for (const tile of tiles) {
          const tx = Math.floor(tile / GRID_KEY_STRIDE);
          const ty = tile - tx * GRID_KEY_STRIDE;
          if (!squareNearBox(box, tx << TILE_SHIFT, ty << TILE_SHIFT, TILE_SIZE, 0)) continue;
          for (const node of this.tiles.get(tile) ?? NO_NODES) {
            const nx = Math.floor(node.key / GRID_KEY_STRIDE);
            const ny = node.key - nx * GRID_KEY_STRIDE;
            if (nx < box.minX || nx > box.maxX || ny < box.minY || ny > box.maxY) continue;
            for (const e of node.entities) visit(e, nx, ny);
          }
        }
      }
    }
  }

  /** The ring radius from `(x,y)` covering every bucket, or -1 when there is none. */
  reach(x: number, y: number): number {
    if (this.size === 0) return -1;
    const { xs, ys } = this;
    return Math.max(x - xs.min, xs.max - x) + Math.max(y - ys.min, ys.max - y);
  }
}

const NO_NODES: readonly GridNode[] = [];
const tileKey = (key: number): number => key;
const nodeKeyOf = (node: GridNode): number => node.key;
const entityId = (e: Entity): number => e;

/** The gap along one axis from `v` to the span `[min, min + size - 1]`, 0 inside it. */
function spanGap(v: number, min: number, size: number): number {
  return Math.max(0, min - v, v - (min + size - 1));
}

/** The farthest any coordinate of the span `[min, min + size - 1]` lies from `v` along one axis. */
function spanReach(v: number, min: number, size: number): number {
  return Math.max(v - min, min + size - 1 - v);
}

/** Whether the square of side `size` from `(minX, minY)` holds a node within `slack` of `box` on both
 *  axes. */
function squareNearBox(box: NodeBox, minX: number, minY: number, size: number, slack: number): boolean {
  return (
    minX + size - 1 >= box.minX - slack &&
    minX <= box.maxX + slack &&
    minY + size - 1 >= box.minY - slack &&
    minY <= box.maxY + slack
  );
}
