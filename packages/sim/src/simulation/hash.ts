import { FNV_OFFSET_BASIS, fnvHex, fnvMixWord } from '@open-northland/data';
import { isPlainRecord, valueShapeName } from '../core/plain-value.js';
import type { World } from '../ecs/world.js';
import type { FogState } from '../systems/vision/index.js';

/**
 * A canonical hash of all simulation state, in a fixed order: tick, RNG state, every registered
 * component on every alive entity by ascending id, then the fog masks. Any divergence must change it.
 */
export function hashSimState(
  world: World,
  tick: number,
  rngState: number,
  fog: FogState | undefined,
): string {
  let h = FNV_OFFSET_BASIS;
  const mix = (n: number): void => {
    h = fnvMixWord(h, n);
  };
  // Length first, so a different split of the same characters stays distinct. charCodeAt covers both
  // halves of a surrogate pair.
  const mixString = (s: string): void => {
    mix(s.length);
    for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
  };
  const hashValue = (v: unknown): void => {
    if (typeof v === 'number') {
      // Both halves, so a large fixed-point double is fully covered.
      mix(v | 0);
      mix(Math.trunc(v / 0x100000000));
    } else if (typeof v === 'string') {
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
    } else if (isPlainRecord(v)) {
      for (const k of Object.keys(v).sort()) {
        mixString(k);
        hashValue(v[k]);
      }
    } else {
      // An uncovered shape would hide a divergence: a Set or bigint mixes in nothing.
      throw new Error(`hashState: unhashable value shape ${valueShapeName(v)}`);
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
  // Fog masks are simulated state living outside the components, so they mix their own canonical bytes.
  fog?.hashInto(mix);
  return fnvHex(h);
}
