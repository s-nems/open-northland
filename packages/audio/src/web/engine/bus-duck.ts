import { rampParam } from './ramps.js';

/** A duck's fade each way, in seconds: quick enough that the alert lands on a lowered mix, slow enough
 *  not to pump. Approximation. */
export const BUS_DUCK_RAMP_S = 0.08;

/**
 * A gain stage behind a bus that dips it for a while, so a slider move on the bus and a running dip
 * compose. A new dip extends a running one and deepens it, never lifts it early; dips of one depth
 * share a single hold rather than stacking, and a dip that lands mid-release ramps down from where the
 * release has got to.
 */
export class BusDuck {
  readonly node: GainNode;
  /** Audio-clock time the dip may lift at; null while the bus is not ducked. */
  private until: number | null = null;
  private depth = 1;

  /** `releaseS` is the lift's fade back to full; the dip itself fades in over {@link BUS_DUCK_RAMP_S}. */
  constructor(
    ctx: BaseAudioContext,
    private readonly releaseS = BUS_DUCK_RAMP_S,
  ) {
    this.node = ctx.createGain();
    this.node.gain.value = 1;
  }

  /** Dip the bus by `db` for `holdS` seconds from now. */
  hold(ctx: BaseAudioContext, db: number, holdS: number): void {
    const gain = 10 ** (db / 20);
    if (gain < this.depth) {
      this.depth = gain;
      rampParam(ctx, this.node.gain, gain, BUS_DUCK_RAMP_S);
    }
    this.until = Math.max(this.until ?? 0, ctx.currentTime + holdS);
  }

  /** Lift a run-out dip; call every applied frame. */
  update(ctx: BaseAudioContext): void {
    if (this.until === null || ctx.currentTime < this.until) return;
    rampParam(ctx, this.node.gain, 1, this.releaseS);
    this.until = null;
    this.depth = 1;
  }
}
