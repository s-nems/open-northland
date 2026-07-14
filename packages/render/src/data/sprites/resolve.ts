import type { DrawItem } from '../scene/index.js';
import { type AtlasFrame, lookupFrame, type SpriteAtlas } from './atlas.js';
import type { SpriteBindings } from './bindings.js';
import { resolveBuildingDraw, resolveResourceDraw, resolveStockpileDraw } from './layered.js';
import type { BuildingTypeBinding, ResourceTypeBinding, StockpileBinding } from './layered-bindings.js';
import { resolveSettlerBobId } from './settler.js';
import type { SettlerStateBinding } from './settler-bindings.js';

/**
 * The top-level frame-selection dispatch: one entry point that routes a drawable {@link DrawItem} to
 * its kind's resolver, kept separate from the GPU texture binding.
 */

/**
 * Resolve the atlas bob id a drawable {@link DrawItem} should draw — the frame *selection* alone (no
 * atlas lookup), so the GPU layer can draw the same id from several layered atlases (body + head)
 * without re-deciding per layer. Returns `null` for a terrain tile or an unbound kind. Routes a
 * settler to {@link resolveSettlerBobId} (by state + facing + `tick`), a building to
 * {@link resolveBuildingDraw} (by `typeId`), a resource to {@link resolveResourceDraw} (by
 * `goodType`), and a stockpile to {@link resolveStockpileDraw} (by good + fill).
 */
export function resolveSpriteBobId(item: DrawItem, bindings: SpriteBindings, tick = 0): number | null {
  if (item.kind === 'tile') return null; // tiles bind by typeId, not these per-kind bindings
  // A projectile never binds an atlas frame (no decoded arrow bob exists) — the GPU pool draws its
  // oriented-arrow marker instead (see gpu/sprite-pool/placeholder.ts).
  if (item.kind === 'projectile') return null;
  // A ground drop (freshly-felled trunk) draws its per-good pickup-stage frame from the `trunk` binding
  // via the per-good resource resolver; the DrawKind ('grounddrop') and binding key ('trunk') differ, so
  // it is resolved explicitly rather than through the generic `bindings[kind]` lookup. resolveResourceDraw's
  // null means an invisible level; this bare-atlas path collapses it to the placeholder so the
  // synthetic/debug sheet shows every entity, where the GPU path (gpu/sprite-pool/resolve-layers.ts) draws
  // nothing.
  if (item.kind === 'grounddrop')
    return bindings.trunk === undefined ? null : (resolveResourceDraw(bindings.trunk, item)?.bob ?? null);
  const binding = bindings[item.kind];
  if (binding === undefined) return null; // kind unbound -> placeholder
  if (item.kind === 'settler')
    return resolveSettlerBobId(binding as number | SettlerStateBinding, item, tick);
  if (item.kind === 'building') return resolveBuildingDraw(binding as number | BuildingTypeBinding, item).bob;
  // resource, stump and berrybush all reuse the per-good resource resolver — a stump draws its debris
  // frame, a bush its per-variant ripe/bare frame, the same way a node draws its species, each from the
  // atlas its own binding names.
  if (item.kind === 'resource' || item.kind === 'stump' || item.kind === 'berrybush')
    return resolveResourceDraw(binding as number | ResourceTypeBinding, item)?.bob ?? null;
  return resolveStockpileDraw(binding as number | StockpileBinding, item).bob; // stockpile
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
 * mid-swing its `acting` frame — when the binding is a {@link SettlerStateBinding}; a plain-number
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
