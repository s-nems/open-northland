import type { FamilyEffectsBinding } from '@open-northland/render';
import type { ContentIr } from './ir/rows.js';
import { particleRef } from './particle-gfx.js';

/** Names, palettes and frame order from `particel.cif`, also verified in the owned data. */
export function resolveFamilyEffects(ir: ContentIr | null): FamilyEffectsBinding {
  const named = (name: string) => {
    const record = ir?.particles?.find((p) => p.name === name);
    return record === undefined ? undefined : particleRef(record);
  };
  return { hearts: named('lovehearts'), stork: named('stork') };
}

export function loadedFamilyEffects(
  refs: FamilyEffectsBinding,
  loaded: ReadonlySet<string>,
): FamilyEffectsBinding {
  return {
    hearts: refs.hearts !== undefined && loaded.has(refs.hearts.layer) ? refs.hearts : undefined,
    stork: refs.stork !== undefined && loaded.has(refs.stork.layer) ? refs.stork : undefined,
  };
}
