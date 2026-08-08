/**
 * Deterministic seeded PRNG (mulberry32), the only source of randomness allowed in the sim; never use
 * Math.random there. `Simulation` owns the sim's instance and systems reach it as `ctx.rng`. The same
 * seed always yields the same sequence on every platform, which is what makes runs reproducible.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Ensure a 32-bit integer state.
    this.state = seed >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  /** Snapshot the internal state; it is part of the golden state hash. */
  getState(): number {
    return this.state;
  }

  /** Adopt a stream position verbatim, exactly as {@link getState} reported it - `next()`'s `| 0` can
   *  leave a negative state, and normalizing here would break a save's byte-identical round trip. */
  setState(state: number): void {
    if (!Number.isInteger(state)) throw new Error(`rng state must be an integer, got ${state}`);
    this.state = state;
  }
}
