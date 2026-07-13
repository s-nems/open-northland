/**
 * Deterministic seeded PRNG (mulberry32). The ONLY source of randomness allowed in the sim.
 *
 * Never use Math.random in `sim`. Get one of these from the world (`world.rng`). The same seed
 * always yields the same sequence on every platform, which is what makes runs reproducible.
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

  /** Snapshot the internal state (for save/load and golden tests). */
  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }
}
