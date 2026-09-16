import type { DrawItem } from '../scene/index.js';
import { type AtlasFrame, lookupFrame, type SpriteAtlas } from './atlas.js';
import type { SpriteBindings } from './bindings.js';
import {
  resolveBuildingDraw,
  resolveResourceDraw,
  resolveSignpostDraw,
  resolveStockpileDraw,
} from './layered.js';
import { resolveSettlerBobId } from './settler.js';

/**
 * Frame selection alone, without the atlas lookup, so the GPU layer can draw one id from several
 * layered atlases without re-deciding per layer. `null` means a terrain tile or an unbound kind.
 */
export function resolveSpriteBobId(item: DrawItem, bindings: SpriteBindings, tick = 0): number | null {
  // The unbound checks cover the required-typed keys too: the binding record is content-built, and a
  // caller outside the type system gets the placeholder rather than a crash.
  switch (item.kind) {
    case 'tile':
      return null;
    case 'projectile':
      return null;
    case 'fish': {
      const binding = bindings.fish;
      if (binding === undefined || binding.bobs.length === 0) return null;
      const frame = Math.floor(tick / Math.max(1, binding.ticksPerFrame)) + item.ref;
      return (
        binding.bobs[((frame % binding.bobs.length) + binding.bobs.length) % binding.bobs.length] ?? null
      );
    }
    case 'settler':
      return bindings.settler === undefined ? null : resolveSettlerBobId(bindings.settler, item, tick);
    case 'building':
      return bindings.building === undefined ? null : resolveBuildingDraw(bindings.building, item).bob;
    case 'resource':
    case 'stump':
    case 'berrybush':
    case 'chest':
    case 'grounddrop': {
      // A ground drop's kind and binding key differ, so it names its key instead of reusing `item.kind`.
      const binding = item.kind === 'grounddrop' ? bindings.trunk : bindings[item.kind];
      // Unlike the GPU path, this one collapses a data-pinned invisible level to the placeholder.
      return binding === undefined ? null : (resolveResourceDraw(binding, item)?.bob ?? null);
    }
    case 'signpost':
      return resolveSignpostDraw(bindings.signpost, item)?.bob ?? null;
    case 'stockpile':
      return bindings.stockpile === undefined
        ? null
        : resolveStockpileDraw(bindings.stockpile, item, tick).bob;
    default: {
      const _exhaustive: never = item.kind;
      void _exhaustive;
      return null;
    }
  }
}

/**
 * The atlas rect to blit for a draw item, or `null` for "no bound sprite, draw the placeholder": a
 * terrain tile, an unbound kind, or a bob id the atlas has no frame for.
 */
export function resolveSpriteFrame(
  item: DrawItem,
  bindings: SpriteBindings,
  atlas: SpriteAtlas,
  tick = 0,
): AtlasFrame | null {
  const bobId = resolveSpriteBobId(item, bindings, tick);
  if (bobId === null) return null;
  return lookupFrame(atlas, bobId);
}
