/** An axis-aligned box in fractional tile units, both ends inclusive. */
export interface TileBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Bucket side in tiles. Approximation: a 1080p viewport with its sprite margin overlaps a few dozen
 *  buckets and a developed map fills several hundred; any similar power of two works. */
export const TILE_BUCKET_SIZE = 8;

/** Bucket key packing `bx * stride + by`, collision-free while `|by| < stride / 2`: a map of 2^17 tile
 *  rows, far past any decoded map. */
const KEY_STRIDE = 1 << 15;

interface BucketRecord<T> {
  readonly id: number;
  item: T;
  key: number;
  /** Position inside its bucket array, for the swap-pop removal. */
  slot: number;
}

/**
 * Items keyed by id and bucketed by a fractional tile position, retained across updates: a box query
 * walks only the buckets it overlaps, so its cost follows the box and the items in it, not the map.
 * Query order is arbitrary; a consumer that needs a stable order sorts the result.
 */
export class TileBuckets<T> {
  private readonly records = new Map<number, BucketRecord<T>>();
  private readonly buckets = new Map<number, BucketRecord<T>[]>();

  get size(): number {
    return this.records.size;
  }

  has(id: number): boolean {
    return this.records.has(id);
  }

  get(id: number): T | undefined {
    return this.records.get(id)?.item;
  }

  /** Place `item` under `id` at the tile position, moving it when `id` sits in another bucket. */
  set(id: number, item: T, tileX: number, tileY: number): void {
    const key = bucketKey(tileX, tileY);
    const held = this.records.get(id);
    if (held === undefined) {
      const record: BucketRecord<T> = { id, item, key, slot: 0 };
      this.records.set(id, record);
      this.insert(record, key);
      return;
    }
    held.item = item;
    if (held.key !== key) {
      this.removeFromBucket(held);
      this.insert(held, key);
    }
  }

  /** Swap the item held under `id` in place, keeping its bucket; a no-op for an id not held. */
  replace(id: number, item: T): void {
    const held = this.records.get(id);
    if (held !== undefined) held.item = item;
  }

  delete(id: number): boolean {
    const held = this.records.get(id);
    if (held === undefined) return false;
    this.removeFromBucket(held);
    this.records.delete(id);
    return true;
  }

  /** Every item whose position may fall inside `box`: a superset by up to one bucket on each side, so
   *  the caller still tests each item. Appends to `out` and returns it. */
  within(box: TileBox, out: T[] = []): T[] {
    const bx0 = Math.floor(box.minX / TILE_BUCKET_SIZE);
    const bx1 = Math.floor(box.maxX / TILE_BUCKET_SIZE);
    const by0 = Math.floor(box.minY / TILE_BUCKET_SIZE);
    const by1 = Math.floor(box.maxY / TILE_BUCKET_SIZE);
    // Cost is min(box, population): a see-everything box must not scan its own empty area, so past the
    // populated-bucket count the walk flips to the buckets.
    if ((bx1 - bx0 + 1) * (by1 - by0 + 1) > this.buckets.size) {
      for (const [key, bucket] of this.buckets) {
        const bx = Math.round(key / KEY_STRIDE); // exact: |by| < KEY_STRIDE / 2
        const by = key - bx * KEY_STRIDE;
        if (bx < bx0 || bx > bx1 || by < by0 || by > by1) continue;
        for (const record of bucket) out.push(record.item);
      }
      return out;
    }
    for (let bx = bx0; bx <= bx1; bx++) {
      for (let by = by0; by <= by1; by++) {
        const bucket = this.buckets.get(bx * KEY_STRIDE + by);
        if (bucket === undefined) continue;
        for (const record of bucket) out.push(record.item);
      }
    }
    return out;
  }

  private insert(record: BucketRecord<T>, key: number): void {
    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      bucket = [];
      this.buckets.set(key, bucket);
    }
    record.key = key;
    record.slot = bucket.length;
    bucket.push(record);
  }

  private removeFromBucket(record: BucketRecord<T>): void {
    const bucket = this.buckets.get(record.key);
    if (bucket === undefined) return; // unreachable: every record sits in its keyed bucket
    const last = bucket.pop();
    if (last !== undefined && last !== record) {
      bucket[record.slot] = last;
      last.slot = record.slot;
    }
    if (bucket.length === 0) this.buckets.delete(record.key); // an emptied bucket must not linger
  }
}

function bucketKey(tileX: number, tileY: number): number {
  return Math.floor(tileX / TILE_BUCKET_SIZE) * KEY_STRIDE + Math.floor(tileY / TILE_BUCKET_SIZE);
}
