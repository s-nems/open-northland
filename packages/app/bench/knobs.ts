/** Env knobs shared by the benchmarks. Each throws on a malformed value rather than silently
 *  benchmarking a different world than the caller asked for. */
import { onOffParam } from '../src/game/session-rules.js';

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

/** An on/off env knob: `on` or `1` enable it, `off`, `0` and unset leave it off. */
export function boolEnv(name: string): boolean {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === '' || raw === 'off' || raw === '0') return false;
  if (raw === 'on' || raw === '1') return true;
  throw new Error(`${name} must be on/1 or off/0, got '${raw}'`);
}

/** A non-empty string env knob, or `fallback` when unset/blank. */
export function stringEnv(name: string, fallback: string): string {
  const raw = process.env[name]?.trim();
  return raw === undefined || raw === '' ? fallback : raw;
}

/** A comma list of distinct integers of at least `min`, ascending; empty when unset/blank. An empty
 *  item is skipped, so `3,` is the one-item list. */
export function intListEnv(name: string, min: number): readonly number[] {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === '') return [];
  const values: number[] = [];
  for (const item of raw.split(',')) {
    const text = item.trim();
    if (text === '') continue;
    const value = Number(text);
    if (!Number.isInteger(value) || value < min) {
      throw new Error(`${name} must list integers >= ${min}, got '${text}' in '${raw}'`);
    }
    if (values.includes(value)) throw new Error(`${name} lists ${value} twice in '${raw}'`);
    values.push(value);
  }
  return values.sort((a, b) => a - b);
}

/** A session rule override spelled as its URL flag (`on`/`off`), or null when unset/blank, which keeps
 *  the world's own rule. */
export function ruleEnv(name: string): boolean | null {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === '') return null;
  const value = onOffParam(new URLSearchParams([[name, raw]]), name);
  if (value === null) throw new Error(`${name} must be on or off, got '${raw}'`);
  return value;
}
