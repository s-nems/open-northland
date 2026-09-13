import type { WireFrame } from '@open-northland/net-protocol';

/** Retention budgets are deployment limits, independent of room speed and client cooperation. */
export const MAX_HISTORY_BYTES = 16 * 1024 * 1024;
export const MAX_HISTORY_AGE_MS = 10 * 60_000;
export const HISTORY_REFRESH_BYTES = MAX_HISTORY_BYTES / 2;
export const HISTORY_REFRESH_AGE_MS = MAX_HISTORY_AGE_MS / 2;

export interface CachedSnapshot {
  readonly tick: number;
  readonly from: string;
  readonly bytes: string;
}

interface RetainedFrame {
  readonly frame: WireFrame;
  readonly bytes: number;
  readonly recordedAt: number;
}

/** The cached snapshot and an uninterrupted replay after it, bounded before admitting each frame. */
export class CatchUpStore {
  private readonly frames: RetainedFrame[] = [];
  private cached: CachedSnapshot | null = null;
  private retainedBytes = 0;

  get snapshot(): CachedSnapshot | null {
    return this.cached;
  }

  get bytes(): number {
    return this.retainedBytes;
  }

  needsRefresh(now: number): boolean {
    return this.retainedBytes >= HISTORY_REFRESH_BYTES || this.age(now) >= HISTORY_REFRESH_AGE_MS;
  }

  expired(now: number): boolean {
    return this.age(now) >= MAX_HISTORY_AGE_MS;
  }

  record(frame: WireFrame, now: number): boolean {
    const bytes = Buffer.byteLength(JSON.stringify(frame));
    if (this.expired(now) || this.retainedBytes + bytes > MAX_HISTORY_BYTES) return false;
    this.frames.push({ frame, bytes, recordedAt: now });
    this.retainedBytes += bytes;
    return true;
  }

  framesAfter(tick: number): readonly WireFrame[] | null {
    const first = this.frames[0]?.frame.tick ?? (this.cached === null ? 1 : this.cached.tick + 1);
    if (tick + 1 < first) return null;
    return this.frames.filter(({ frame }) => frame.tick > tick).map(({ frame }) => frame);
  }

  /** Frames paced ahead of a confirmed result must not outlive the terminal simulation tick. */
  finishAt(tick: number): void {
    const first = this.frames.findIndex(({ frame }) => frame.tick > tick);
    if (first < 0) return;
    for (const removed of this.frames.splice(first)) this.retainedBytes -= removed.bytes;
  }

  cache(snapshot: CachedSnapshot): boolean {
    if (this.cached !== null && snapshot.tick <= this.cached.tick) return false;
    this.cached = snapshot;
    const kept = this.frames.findIndex(({ frame }) => frame.tick > snapshot.tick);
    for (const removed of this.frames.splice(0, kept === -1 ? this.frames.length : kept)) {
      this.retainedBytes -= removed.bytes;
    }
    return true;
  }

  private age(now: number): number {
    const first = this.frames[0];
    return first === undefined ? 0 : now - first.recordedAt;
  }
}
