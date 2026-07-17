import type { World } from '../ecs/world.js';
import type { FogState } from '../systems/vision/index.js';

/**
 * A canonical hash of ALL simulation state for determinism golden tests (see
 * {@link import('../simulation.js').Simulation.hashState}): tick, RNG state, every registered component
 * on every alive entity in canonical (ascending) order, then the fog masks. If two runs from the same
 * seed + inputs diverge in ANY hashed field, this changes — which is the point.
 */
export function hashSimState(
  world: World,
  tick: number,
  rngState: number,
  fog: FogState | undefined,
): string {
  let h = 2166136261 >>> 0; // FNV-1a
  const mix = (n: number): void => {
    h ^= n | 0;
    h = Math.imul(h, 16777619) >>> 0;
  };
  // Length first, so a differing split of the same characters ('ab'+'c' vs 'a'+'bc') stays distinct;
  // charCodeAt covers both halves of a surrogate pair.
  const mixString = (s: string): void => {
    mix(s.length);
    for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
  };
  const hashValue = (v: unknown): void => {
    if (typeof v === 'number') {
      // hash both halves so large fixed-point doubles are fully covered.
      mix(v | 0);
      mix(Math.trunc(v / 0x100000000));
    } else if (typeof v === 'string') {
      // String values carry real state (an AtomicEffect's `kind`, ChildOrder's `child`), so a run
      // diverging only in one must move the hash.
      mixString(v);
    } else if (typeof v === 'boolean') {
      mix(v ? 1 : 0);
    } else if (v === null || v === undefined) {
      mix(0x9e3779b9);
    } else if (Array.isArray(v)) {
      mix(v.length);
      for (const item of v) hashValue(item);
    } else if (v instanceof Map) {
      for (const [k, val] of [...v.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
        hashValue(k);
        hashValue(val);
      }
    } else if (typeof v === 'object') {
      for (const k of Object.keys(v as object).sort()) {
        mixString(k);
        hashValue((v as Record<string, unknown>)[k]);
      }
    }
  };

  mix(tick);
  mix(rngState);
  const ids = world.canonicalEntities();
  mix(ids.length);
  for (const e of ids) {
    mix(e);
    for (const [name, val] of world.componentEntries(e)) {
      mixString(name);
      hashValue(val);
    }
  }
  // The fog masks are simulated state living OUTSIDE the components (see systems/vision) — they mix their
  // own canonical bytes in after the components.
  fog?.hashInto(mix);
  return h.toString(16).padStart(8, '0');
}
