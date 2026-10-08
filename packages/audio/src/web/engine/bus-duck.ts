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

/**
 * A gain stage behind a bus that dips it for a while, so a slider move on the bus and a running dip
 * compose. A new dip extends a running one and deepens it, never lifts it early; dips of one depth
 * share a single hold rather than stacking, and a dip that lands mid-release ramps down from where the
 * release has got to. The lift is scheduled on the audio clock with the dip, so it lands on time while
 * nothing calls in per frame, such as in a hidden tab that keeps its sound.
 */
export class BusDuck {
  readonly node: GainNode;
  private readonly shape: DuckShape;
  /** Audio-clock time the scheduled lift starts at; null while the bus is not ducked. */
  private until: number | null = null;
  private depth = 1;

  constructor(ctx: BaseAudioContext, shape: Partial<DuckShape> = {}) {
    this.shape = { ...DEFAULT_SHAPE, ...shape };
    this.node = ctx.createGain();
    this.node.gain.value = 1;
  }

  /** Dip the bus by `db` for `holdS` seconds from now. */
  hold(ctx: BaseAudioContext, db: number, holdS: number): void {
    const now = ctx.currentTime;
    if (this.until !== null && now >= this.until) {
      this.until = null; // the scheduled lift is under way or done
      this.depth = 1;
    }
    const gain = 10 ** (db / 20);
    const param = this.node.gain;
    if (gain < this.depth) {
      this.depth = gain;
      // Read the live level before cancelling: cancelling first drops the ramp this anchor must capture.
      const from = Math.max(param.value, gain);
      param.cancelScheduledValues(now);
      param.setValueAtTime(from, now);
      this.rampTo(param, gain, now + this.shape.dipS);
      this.until = Math.max(this.until ?? 0, now + holdS, now + this.shape.dipS);
      this.scheduleLift(param, this.until);
      return;
    }
    const until = now + holdS;
    if (this.until === null || until <= this.until) return;
    param.cancelScheduledValues(this.until); // drop the lift scheduled at the old end
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
