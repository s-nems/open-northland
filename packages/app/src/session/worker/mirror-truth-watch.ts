import { MirrorTruth, type SnapshotDelta, type SnapshotMirror } from '@open-northland/sim';
import { diag } from '../../diag/log.js';

/**
 * The `debug=diag` proof that the mirror the runtime draws from is the worker's world: after every
 * applied delta, the digest the worker folded into it; on the invariant cadence, every maintained index
 * against a fresh walk. Findings land in the diagnostics log. A digest mismatch is logged when it
 * starts, not again on each batch it lasts.
 */
export class MirrorTruthWatch {
  private readonly truth = new MirrorTruth();
  private parted = false;

  constructor(private readonly mirror: SnapshotMirror) {}

  applied(delta: SnapshotDelta): void {
    const mismatch = this.truth.check(delta, this.mirror.snapshot());
    if (mismatch !== null && !this.parted) {
      diag.error('mirror', `the drawn world parted from the worker's at tick ${mismatch.tick}`, mismatch);
    }
    this.parted = mismatch !== null;
  }

  /** Re-walks every held index, about 30 ms at 18 000 entities, so it runs on the invariant ticks only. */
  checkIndexes(tick: number): void {
    const differences = this.mirror.verifyIndexes();
    if (differences.length > 0) {
      diag.error('mirror', `snapshot indexes disagree with the drawn world at tick ${tick}`, {
        tick,
        differences,
      });
    }
  }
}
