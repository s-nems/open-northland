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
 * Resolve the atlas bob id a drawable {@link DrawItem} should draw — the frame *selection* alone (no
 * atlas lookup), so the GPU layer can draw the same id from several layered atlases (body + head)
 * without re-deciding per layer. Returns `null` for a terrain tile or an unbound kind.
 */
export function resolveSpriteBobId(item: DrawItem, bindings: SpriteBindings, tick = 0): number | null {
  // The unbound checks cover the required-typed keys too: the binding record is content-built, and a
  // caller outside the type system gets the placeholder rather than a crash.
  switch (item.kind) {
    case 'tile': // tiles bind by landscape typeId, not these per-kind bindings
      return null;
    // A projectile never binds an atlas frame (no decoded arrow bob exists) — the GPU pool draws its
    // oriented-arrow marker instead (see gpu/sprite-pool/placeholder.ts).
    case 'projectile':
      return null;
    case 'settler':
      return bindings.settler === undefined ? null : resolveSettlerBobId(bindings.settler, item, tick);
    case 'building':
      return bindings.building === undefined ? null : resolveBuildingDraw(bindings.building, item).bob;
    // resource, stump and berrybush all reuse the per-good resource resolver — a stump draws its debris
    // frame, a bush its per-variant ripe/bare frame, the same way a node draws its species, each from the
    // atlas its own binding names. A ground drop joins them through the `trunk` binding: the DrawKind
    // ('grounddrop') and the binding key differ, so it names its key instead of reusing `item.kind`.
    case 'resource':
    case 'stump':
    case 'berrybush':
    case 'grounddrop': {
      const binding = item.kind === 'grounddrop' ? bindings.trunk : bindings[item.kind];
      // A null draw is an invisible level; this bare-atlas path collapses it to the placeholder so the
      // synthetic/debug sheet shows every entity, where the GPU path (gpu/sprite-pool/resolve-layers.ts)
      // draws nothing.
      return binding === undefined ? null : (resolveResourceDraw(binding, item)?.bob ?? null);
    }
    // A signpost resolves its post/board frame from the dedicated binding (placeholder when unbound).
    case 'signpost':
      return resolveSignpostDraw(bindings.signpost, item)?.bob ?? null;
    case 'stockpile':
      return bindings.stockpile === undefined ? null : resolveStockpileDraw(bindings.stockpile, item).bob;
    default: {
      // Exhaustiveness guard: a new DrawKind fails to assign to `never` here instead of silently
      // taking a neighbouring kind's resolver.
      const _exhaustive: never = item.kind;
      void _exhaustive;
      return null;
    }
  }
}

/**
 * Resolve the atlas frame a drawable {@link DrawItem} should draw, given the per-kind {@link SpriteBindings}
 * and the loaded {@link SpriteAtlas}. Returns `null` — meaning "no bound sprite, draw the placeholder" —
 * when:
 *  - the item is a terrain tile (tiles bind by landscape typeId, a separate path), or
 *  - the kind has no binding, or
 *  - the bound bob id isn't in the atlas (a missing/0×0 frame).
 *
 * For a settler the bob id is chosen by the item's {@link import('../scene/index.js').SpriteState} (and
 * atomic id) via {@link resolveSettlerBobId} — a settler walking resolves its `moving` frame, one
 * mid-swing its `acting` frame — when the binding is a
 * {@link import('./settler-bindings.js').SettlerStateBinding}; a plain-number
 * settler binding draws the same frame regardless of state (back-compat).
 *
 * The GPU layer calls this per draw item; a `null` keeps the current placeholder geometry, a frame is
 * the atlas rect to blit.
 */
export function resolveSpriteFrame(
  item: DrawItem,
  bindings: SpriteBindings,
  atlas: SpriteAtlas,
  tick = 0,
): AtlasFrame | null {
  const bobId = resolveSpriteBobId(item, bindings, tick);
  if (bobId === null) return null;
  // A missing or 0-area frame is an empty/zero-size bob — treat it as unbound so the placeholder draws.
  return lookupFrame(atlas, bobId);
}
