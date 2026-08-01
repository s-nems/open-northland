import type { EntitySnapshot, WorldSnapshot } from '@open-northland/sim';
import { ONE, tileToScreenX, tileToScreenY, type Viewport } from '../projection/index.js';
import { classify, readPosition } from './snapshot-readers/index.js';

/**
 * The retained spatial index behind the sprite scene's viewport walk: every drawable entity (a
 * {@link classify}-able marker + Position) bucketed by its pre-lift screen anchor, kept ACROSS
 * snapshots so the per-frame draw-list build probes the buckets under the camera instead of every
 * entity (the render contract's "add a tested spatial query rather than weakening culling").
 *
 * The index must survive across snapshots: once the tick outruns the frame, per-snapshot work IS
 * per-frame work, so a full rebuild would just move the walk. A refresh therefore rides
 * {@link EntitySnapshot} identity — an unchanged entity (the sim's scenery clone cache, a map's
 * standing forests) costs one pointer compare, and only changed ones re-classify and re-bucket.
 * Departures (deaths, lost markers) stop matching via the generation stamp immediately and are
 * reclaimed by a bounded sweep, like the pool's reap.
 *
 * Bucket membership uses the same anchor formula the scene build culls with, so a bucket-range query
 * over the (margin-inflated) viewport is a strict superset of the visible set — the per-item
 * `isVisible` test stays exact. Query order is arbitrary (bucket + insertion history); the scene's
 * total `(depth, ref)` sort restores determinism.
 */

/** Bucket side in pre-lift screen px. Approximation: a few tile columns/rows per bucket, so a
 *  1080p-with-margin viewport touches ~100 buckets; any similar power of two works. */
const BUCKET_PX = 256;

/** Bucket key packing `bx * stride + by` — collision-free while `|by| < stride / 2`, i.e. screen y
 *  within ±2^22 px (a 4096-row map reaches ~156k px). */
const KEY_STRIDE = 1 << 15;

/** Stale-record slots reclaimed per {@link SpriteSpatialIndex.update} — bounds the death sweep like
 *  the pool's reap budget; a stale record is already unqueryable (generation mismatch), so the sweep
 *  is memory reclamation only. */
const SWEEP_BUDGET = 4096;

interface IndexRecord {
  readonly id: number;
  /** The entity's snapshot object as of the last refresh — the identity short-circuit's handle. */
  entity: EntitySnapshot;
  /** Stamp of the last {@link SpriteSpatialIndex.update} that saw the entity alive; a mismatch means
   *  it left the snapshot (or the bucket walk hasn't reclaimed it yet). */
  gen: number;
  key: number;
  /** Position inside its bucket array, for the swap-pop removal. */
  slot: number;
}

export class SpriteSpatialIndex {
  private snapshot: WorldSnapshot | null = null;
  private gen = 0;
  /** Record per entity id — a dense array (ids are small monotonic ints) kept packed by pushing
   *  `undefined` up to a new id, so lookups stay array-fast instead of dictionary-mode. Accepted
   *  growth: sized by the largest id ever seen (one slot per id, never shrunk). */
  private readonly byId: (IndexRecord | undefined)[] = [];
  private readonly buckets = new Map<number, IndexRecord[]>();
  private sweepAt = 0;
  /** Reused query output — valid until the next {@link query} or {@link update}. */
  private readonly scratch: EntitySnapshot[] = [];

  /** Bring the index up to `snapshot` (idempotent per snapshot object, so callers need no coherence
   *  protocol — the scene build calls it before every query). */
  update(snapshot: WorldSnapshot): void {
    if (this.snapshot === snapshot) return;
    this.snapshot = snapshot;
    this.gen++;
    for (const entity of snapshot.entities) {
      const rec = this.byId[entity.id];
      if (rec !== undefined && rec.entity === entity) {
        rec.gen = this.gen; // identity-stable (scenery clone cache) — unchanged, same bucket
        continue;
      }
      this.refresh(entity, rec);
    }
    this.sweepStale();
  }

  /** Every current-snapshot drawable whose anchor could pass `isVisible(viewport, …)` — a superset:
   *  the caller still culls per item. The returned array is reused across calls. */
  query(viewport: Viewport): readonly EntitySnapshot[] {
    const out = this.scratch;
    out.length = 0;
    const bx0 = Math.floor(viewport.minX / BUCKET_PX);
    const bx1 = Math.floor(viewport.maxX / BUCKET_PX);
    const by0 = Math.floor(viewport.minY / BUCKET_PX);
    const by1 = Math.floor(viewport.maxY / BUCKET_PX);
    // Query cost is min(box, population): a zoomed-out or see-everything box must not scan its own
    // empty area (±1e6 px is ~61M cells), so past the populated-bucket count the walk flips to the
    // buckets themselves, filtered by decoding each key back to its cell.
    if ((bx1 - bx0 + 1) * (by1 - by0 + 1) > this.buckets.size) {
      for (const [key, bucket] of this.buckets) {
        const bx = Math.round(key / KEY_STRIDE); // exact: |by| < KEY_STRIDE / 2
        const by = key - bx * KEY_STRIDE;
        if (bx < bx0 || bx > bx1 || by < by0 || by > by1) continue;
        this.collectLive(bucket, out);
      }
      return out;
    }
    for (let bx = bx0; bx <= bx1; bx++) {
      for (let by = by0; by <= by1; by++) {
        const bucket = this.buckets.get(bx * KEY_STRIDE + by);
        if (bucket !== undefined) this.collectLive(bucket, out);
      }
    }
    return out;
  }

  private collectLive(bucket: readonly IndexRecord[], out: EntitySnapshot[]): void {
    for (const rec of bucket) {
      if (rec.gen === this.gen) out.push(rec.entity);
    }
  }

  /** Whether `ref` is a drawable entity of the snapshot last passed to {@link update} — the
   *  map-wide liveness answer the scene's membership view serves without a map-wide walk. */
  has(ref: number): boolean {
    const rec = this.byId[ref];
    return rec !== undefined && rec.gen === this.gen;
  }

  /** Re-read a changed (or new) entity: drop it if no longer drawable, otherwise stamp it live and
   *  move it to the bucket under its current anchor. */
  private refresh(entity: EntitySnapshot, rec: IndexRecord | undefined): void {
    const components = entity.components;
    const pos = classify(components) !== null ? readPosition(components) : null;
    if (pos === null) {
      if (rec !== undefined) this.remove(rec);
      return;
    }
    const tileY = pos.y / ONE;
    const key =
      Math.floor(tileToScreenX(pos.x / ONE, tileY) / BUCKET_PX) * KEY_STRIDE +
      Math.floor(tileToScreenY(tileY) / BUCKET_PX);
    if (rec === undefined) {
      const created: IndexRecord = { id: entity.id, entity, gen: this.gen, key, slot: 0 };
      while (this.byId.length <= entity.id) this.byId.push(undefined);
      this.byId[entity.id] = created;
      this.insert(created, key);
      return;
    }
    rec.entity = entity;
    rec.gen = this.gen;
    if (rec.key !== key) {
      this.removeFromBucket(rec);
      this.insert(rec, key);
    }
  }

  private insert(rec: IndexRecord, key: number): void {
    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      bucket = [];
      this.buckets.set(key, bucket);
    }
    rec.key = key;
    rec.slot = bucket.length;
    bucket.push(rec);
  }

  private removeFromBucket(rec: IndexRecord): void {
    const bucket = this.buckets.get(rec.key);
    if (bucket === undefined) return; // unreachable: every record sits in its keyed bucket
    const last = bucket.pop();
    if (last !== undefined && last !== rec) {
      bucket[rec.slot] = last;
      last.slot = rec.slot;
    }
    if (bucket.length === 0) this.buckets.delete(rec.key); // a felled forest must not leave empty arrays behind
  }

  private remove(rec: IndexRecord): void {
    this.removeFromBucket(rec);
    this.byId[rec.id] = undefined;
  }

  /** Reclaim up to {@link SWEEP_BUDGET} stale records per update, round-robin over the id range. */
  private sweepStale(): void {
    const end = Math.min(this.byId.length, this.sweepAt + SWEEP_BUDGET);
    for (let id = this.sweepAt; id < end; id++) {
      const rec = this.byId[id];
      if (rec !== undefined && rec.gen !== this.gen) this.remove(rec);
    }
    this.sweepAt = end >= this.byId.length ? 0 : end;
  }
}
