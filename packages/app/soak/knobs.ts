/** An integer env knob of at least `min`, or `fallback` when unset/blank. Throws on a malformed value
 *  rather than silently soaking a different world than the caller asked for. */
export function intEnv(name: string, fallback: number, min: number): number {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min}, got '${raw}'`);
  }
  return value;
}
