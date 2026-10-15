/** A duck's fade each way, in seconds: quick enough that the alert lands on a lowered mix, slow enough
 *  not to pump. Approximation. */
export const BUS_DUCK_RAMP_S = 0.08;

/** How a duck's gain moves: `linear` in gain, or `exponential`, which is linear in dB. */
export type DuckCurve = 'linear' | 'exponential';

/** A duck's fades: the dip down to its depth, the release back to full, and the curve both follow. */
export interface DuckShape {
  readonly dipS: number;
  readonly releaseS: number;
  readonly curve: DuckCurve;
}

const DEFAULT_SHAPE: DuckShape = { dipS: BUS_DUCK_RAMP_S, releaseS: BUS_DUCK_RAMP_S, curve: 'linear' };

/** One caller's dip, which it may end early with {@link BusDuck.release}. */
export interface DuckHold {
  readonly end: number;
}

/**
 * A gain stage behind a bus that dips it for a while, so a slider move on the bus and a running dip
 * compose. A new dip extends a running one and deepens it, never lifts it early; dips of one depth
 * share a single hold rather than stacking, and a dip that lands mid-release ramps down from where the
 * release has got to. A hold released early lifts only once no other hold runs. The lift is scheduled on the audio clock with the dip, so it lands on time while
 * nothing calls in per frame, such as in a hidden tab that keeps its sound.
 */
export class BusDuck {
  readonly node: GainNode;
  private readonly shape: DuckShape;
  /** Audio-clock time the scheduled lift starts at; null while the bus is not ducked. */
  private until: number | null = null;
  private depth = 1;
  /** Audio-clock time the latest dip reaches its depth; an early lift never cuts that ramp. */
  private dippedAt = 0;
  /** The holds still running under the current duck, so one released early keeps the others. */
  private readonly holds = new Set<DuckHold>();

  constructor(ctx: BaseAudioContext, shape: Partial<DuckShape> = {}) {
    this.shape = { ...DEFAULT_SHAPE, ...shape };
    this.node = ctx.createGain();
    this.node.gain.value = 1;
  }

  /** Dip the bus by `db` for `holdS` seconds from now. */
  hold(ctx: BaseAudioContext, db: number, holdS: number): DuckHold {
    const now = ctx.currentTime;
    if (this.until !== null && now >= this.until) {
      this.until = null; // the scheduled lift is under way or done
      this.depth = 1;
    }
    for (const other of this.holds) if (other.end <= now) this.holds.delete(other);
    const hold: DuckHold = { end: now + holdS };
    this.holds.add(hold);
    const gain = 10 ** (db / 20);
    const param = this.node.gain;
    if (gain < this.depth) {
      this.depth = gain;
      // Read the live level before cancelling: cancelling first drops the ramp this anchor must capture.
      const from = Math.max(param.value, gain);
      param.cancelScheduledValues(now);
      param.setValueAtTime(from, now);
      this.dippedAt = now + this.shape.dipS;
      this.rampTo(param, gain, this.dippedAt);
      this.until = Math.max(this.until ?? 0, now + holdS, this.dippedAt);
      this.scheduleLift(param, this.until);
      return hold;
    }
    const until = now + holdS;
    if (this.until !== null && until > this.until) this.moveLift(param, until);
    return hold;
  }

  /** End `hold` now: the lift moves up to the latest hold still running, never before the dip lands.
   *  The depth stays until the lift, even when the released hold was the deepest. */
  release(ctx: BaseAudioContext, hold: DuckHold): void {
    if (!this.holds.delete(hold) || this.until === null) return;
    const now = ctx.currentTime;
    if (now >= this.until) return; // the lift is under way or done
    let until = Math.max(now, this.dippedAt);
    for (const other of this.holds) until = Math.max(until, other.end);
    if (until < this.until) this.moveLift(this.node.gain, until);
  }

  private moveLift(param: AudioParam, until: number): void {
    param.cancelScheduledValues(this.until ?? until); // drop the lift scheduled at the old end
    this.until = until;
    this.scheduleLift(param, until);
  }

  private scheduleLift(param: AudioParam, at: number): void {
    param.setValueAtTime(this.depth, at);
    this.rampTo(param, 1, at + this.shape.releaseS);
  }

  private rampTo(param: AudioParam, target: number, at: number): void {
    if (this.shape.curve === 'exponential') param.exponentialRampToValueAtTime(target, at);
    else param.linearRampToValueAtTime(target, at);
  }
}
