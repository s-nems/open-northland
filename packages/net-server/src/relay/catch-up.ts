import type { WireFrame } from '@open-northland/net-protocol';

export interface CachedSnapshot {
  readonly tick: number;
  /** The nick of the client that produced it. */
  readonly from: string;
  readonly bytes: string;
}

/**
 * What a client needs to reach the present: the room's cached snapshot, and every frame emitted after
 * it. Frames from tick 1 are kept until the first snapshot arrives, so early on a client rebuilds from
 * the descriptor and replays.
 */
export class CatchUpStore {
  private readonly frames: WireFrame[] = [];
  private cached: CachedSnapshot | null = null;

  get snapshot(): CachedSnapshot | null {
    return this.cached;
  }

  record(frame: WireFrame): void {
    this.frames.push(frame);
  }

  /** The frames after `tick`, or null when the store no longer reaches back that far. */
  framesAfter(tick: number): readonly WireFrame[] | null {
    const first = this.frames[0]?.tick ?? (this.cached === null ? 1 : this.cached.tick + 1);
    if (tick + 1 < first) return null;
    return this.frames.filter((frame) => frame.tick > tick);
  }

  /** Keep the newer of the held snapshot and this one, and drop the frames it makes redundant. */
  cache(snapshot: CachedSnapshot): boolean {
    if (this.cached !== null && snapshot.tick <= this.cached.tick) return false;
    this.cached = snapshot;
    const kept = this.frames.findIndex((frame) => frame.tick > snapshot.tick);
    this.frames.splice(0, kept === -1 ? this.frames.length : kept);
    return true;
  }
}
