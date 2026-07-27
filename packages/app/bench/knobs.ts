/** Env knobs shared by the benchmarks. Both throw on a malformed value rather than silently
 *  benchmarking a different world than the caller asked for. */

/** An integer env knob of at least `min`, or `fallback` when unset/blank. */
export function intEnv(name: string, fallback: number, min: number): number {
  // Trim first: `Number(' ')` is 0, so a blank-but-not-empty value would pass validation as zero.
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min}, got '${raw}'`);
  }
  return value;
}

/** A non-empty string env knob, or `fallback` when unset/blank. */
export function stringEnv(name: string, fallback: string): string {
  const raw = process.env[name]?.trim();
  return raw === undefined || raw === '' ? fallback : raw;
}
