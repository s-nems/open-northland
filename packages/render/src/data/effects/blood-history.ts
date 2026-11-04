import { type SimEvent, TileBuckets, type WorldSnapshot } from '@open-northland/sim';
import { TILE_HALF_H, TILE_HALF_W, type Viewport } from '../projection/index.js';
import {
  BLOOD_LIFETIME_TICKS,
  type BloodMark,
  MAX_BLOOD_MARKS,
  MAX_BLOOD_PER_NODE,
  makeBloodMarks,
} from './blood.js';

/** Ordered expiry and node budgets change only with impacts/removals; queries visit visible buckets. */
export class BloodHistory {
  /** Each live mark's ingest order. */
  private readonly live = new Map<BloodMark, number>();
  /** Each live mark's bucket id, reused once its mark goes: the buckets hold records in an array by id,
   *  which an ever-growing id would stretch by a slot per mark ever made. */
  private readonly bucketIds = new Map<BloodMark, number>();
  private readonly freeBucketIds: number[] = [];
  private readonly perNode = new Map<string, Set<BloodMark>>();
  private buckets = new TileBuckets<BloodMark>();
  private readonly wanted = new Set<BloodMark>();
  private nextId = 0;
  revision = 0;

  constructor(private readonly removed: (mark: BloodMark) => void) {}

  get size(): number {
    return this.live.size;
  }

  /** Diagnostic/test snapshot, never used by the draw loop. */
  values(): readonly BloodMark[] {
    return [...this.live.keys()];
  }

  ingest(
    events: readonly SimEvent[],
    tick: number,
    snapshot?: WorldSnapshot,
    origins?: ReadonlyMap<number, { readonly hx: number; readonly hy: number }>,
  ): void {
    this.expire(tick);
    for (const mark of makeBloodMarks(events, tick, snapshot, origins)) {
      const key = nodeKey(mark);
      let sameNode = this.perNode.get(key);
      if (sameNode === undefined) {
        sameNode = new Set();
        this.perNode.set(key, sameNode);
      }
      if (sameNode.size >= MAX_BLOOD_PER_NODE) {
        const oldest = sameNode.values().next().value;
        if (oldest !== undefined) this.remove(oldest);
      }
      sameNode.add(mark);
      this.live.set(mark, this.nextId++);
      // Without a freed id, the ids in use are exactly 0 to size - 1.
      const bucketId = this.freeBucketIds.pop() ?? this.bucketIds.size;
      this.bucketIds.set(mark, bucketId);
      this.buckets.set(bucketId, mark, mark.hx, mark.hy / 2);
      this.revision++;
      if (this.live.size > MAX_BLOOD_MARKS) {
        const oldest = this.live.keys().next().value;
        if (oldest !== undefined) this.remove(oldest);
      }
    }
  }

  expire(tick: number): void {
    for (const mark of this.live.keys()) {
      if (tick - mark.spawnTick < BLOOD_LIFETIME_TICKS) break;
      this.remove(mark);
    }
  }

  /** Bucket order is arbitrary; chronological order keeps overlapping transparent stains stable. */
  query(view: Viewport, maxLift: number, out: BloodMark[]): void {
    out.length = this.buckets.collect(
      {
        minX: (view.minX - 80) / TILE_HALF_W,
        maxX: (view.maxX + 80) / TILE_HALF_W,
        minY: (view.minY - 80) / TILE_HALF_H,
        maxY: (view.maxY + 80 + maxLift) / TILE_HALF_H,
      },
      out,
    );
    // The live map iterates in ingest order, so walking it sorts a large share of the marks for free.
    if (out.length * Math.log2(out.length + 1) < this.live.size) {
      out.sort((a, b) => (this.live.get(a) ?? 0) - (this.live.get(b) ?? 0));
      return;
    }
    const wanted = this.wanted;
    wanted.clear();
    for (const mark of out) wanted.add(mark);
    let n = 0;
    for (const mark of this.live.keys()) if (wanted.has(mark)) out[n++] = mark;
    out.length = n;
    wanted.clear();
  }

  clear(): void {
    for (const mark of this.live.keys()) this.removed(mark);
    this.live.clear();
    this.bucketIds.clear();
    this.freeBucketIds.length = 0;
    this.perNode.clear();
    this.buckets = new TileBuckets();
    this.nextId = 0;
    this.revision++;
  }

  private remove(mark: BloodMark): void {
    const bucketId = this.bucketIds.get(mark);
    if (bucketId === undefined) return;
    this.live.delete(mark);
    this.bucketIds.delete(mark);
    this.buckets.delete(bucketId);
    this.freeBucketIds.push(bucketId);
    const key = nodeKey(mark);
    const sameNode = this.perNode.get(key);
    sameNode?.delete(mark);
    if (sameNode?.size === 0) this.perNode.delete(key);
    this.removed(mark);
    this.revision++;
  }
}

const nodeKey = (mark: BloodMark): string => `${mark.hx},${mark.hy}`;
