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
    case 'tile': // tiles bind by landscape typeId, not these per-kind bindings
      return null;
    // No decoded arrow bob exists, so the GPU pool draws its own oriented-arrow marker.
    case 'projectile':
      return null;
    case 'settler':
      return bindings.settler === undefined ? null : resolveSettlerBobId(bindings.settler, item, tick);
    case 'building':
      return bindings.building === undefined ? null : resolveBuildingDraw(bindings.building, item).bob;
    // These kinds all reuse the per-good resource resolver, each from the atlas its own binding names.
    // A ground drop's kind and binding key differ, so it names its key instead of reusing `item.kind`.
    case 'resource':
    case 'stump':
    case 'berrybush':
    case 'grounddrop': {
      const binding = item.kind === 'grounddrop' ? bindings.trunk : bindings[item.kind];
      // This bare-atlas path collapses an invisible level to the placeholder so the synthetic sheet
      // shows every entity; the GPU path draws nothing for it.
      return binding === undefined ? null : (resolveResourceDraw(binding, item)?.bob ?? null);
    }
    case 'signpost':
      return resolveSignpostDraw(bindings.signpost, item)?.bob ?? null;
    case 'stockpile':
      return bindings.stockpile === undefined ? null : resolveStockpileDraw(bindings.stockpile, item).bob;
    default: {
      // A new DrawKind must fail to assign here instead of silently taking a neighbour's resolver.
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
