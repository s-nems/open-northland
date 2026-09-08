import { FNV_OFFSET_BASIS, fnvHex, fnvMixWord } from '@open-northland/data';
import { mixString, mixValue } from '../core/hash-value.js';
import type { World } from '../ecs/world.js';
import type { FogState } from '../systems/vision/index.js';

/**
 * A canonical hash of all simulation state, in a fixed order: tick, RNG state, every registered
 * component on every alive entity by ascending id, then the fog masks. Any divergence must change it,
 * within the blind spot `mixValue` documents. Walking every entity makes this too slow to run each
 * tick; `Simulation.syncDigest()` is the per-tick check.
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
  const mixText = (text: string): void => {
    mixString(mix, text);
  };
  mix(tick);
  mix(rngState);
  const ids = world.canonicalEntities();
  mix(ids.length);
  for (const e of ids) {
    mix(e);
    for (const [name, val] of world.componentEntries(e)) {
      mixString(mix, name);
      mixValue(mix, mixText, val);
    }
  }
  // Fog masks are simulated state living outside the components, so they mix their own canonical bytes.
  fog?.hashInto(mix);
  return fnvHex(h);
}
