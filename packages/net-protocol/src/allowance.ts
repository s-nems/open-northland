/** A rate allowance: a burst of `burst` at once, then one more each `refillMs`. */
export class Allowance {
  private left: number;

  constructor(
    private readonly burst: number,
    private readonly refillMs: number,
    private refilledAt: number,
  ) {
    this.left = burst;
  }

  /** Whether it is back to its whole burst. */
  full(now: number): boolean {
    this.refill(now);
    return this.left === this.burst;
  }

  /** Whether one is left, without taking it. */
  has(now: number): boolean {
    this.refill(now);
    return this.left > 0;
  }

  take(now: number): boolean {
    if (!this.has(now)) return false;
    if (this.left === this.burst) this.refilledAt = now;
    this.left--;
    return true;
  }

  private refill(now: number): void {
    const earned = Math.floor((now - this.refilledAt) / this.refillMs);
    if (earned > 0) {
      this.left = Math.min(this.burst, this.left + earned);
      this.refilledAt += earned * this.refillMs;
    }
  }
}
