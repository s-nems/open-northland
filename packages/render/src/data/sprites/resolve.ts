import type { DrawItem } from '../scene/index.js';
import type { AtlasFrame, SpriteAtlas } from './atlas.js';
import type {
  BuildingTypeBinding,
  ResourceTypeBinding,
  SettlerStateBinding,
  SpriteBindings,
  StockpileBinding,
} from './bindings.js';
import { resolveBuildingDraw, resolveResourceDraw, resolveStockpileDraw } from './layered.js';
import { resolveSettlerBobId } from './settler.js';

/**
 * The top-level frame-selection dispatch: one entry point that routes a drawable
 * {@link DrawItem} to its kind's resolver. This is the PURE half of "draw a sprite from the bob
 * atlas" — the part an agent CAN self-verify, kept separate from the GPU texture binding (the
 * un-self-verifiable pixel half, deferred to a human).
 */

/**
 * Resolve the atlas bob id a drawable {@link DrawItem} should draw — the frame *selection* alone (no
 * atlas lookup), so the GPU layer can draw the **same** id from several layered atlases (body + head)
 * without re-deciding per layer. Returns `null` for a terrain tile or an unbound kind. A settler's id
 * is chosen by state + facing + `tick` via {@link resolveSettlerBobId} (animated/directional when the
 * binding is a {@link import('./bindings.js').DirectionalAnim}); a building's by its `typeId` via
 * {@link resolveBuildingDraw} (its own house bob when the binding is a
 * {@link BuildingTypeBinding}); a resource by its `goodType` via {@link resolveResourceDraw} (its own
 * species/deposit node); a stockpile by its good + fill via {@link resolveStockpileDraw} (a per-good
 * pile, or the flag when empty). Pure.
 */
export function resolveSpriteBobId(item: DrawItem, bindings: SpriteBindings, tick = 0): number | null {
  if (item.kind === 'tile') return null; // tiles bind by typeId, not these per-kind bindings
  // A projectile never binds an atlas frame (no decoded arrow bob exists) — the GPU pool draws its
  // oriented-arrow marker instead (see gpu/sprite-pool/placeholder.ts).
  if (item.kind === 'projectile') return null;
  // A ground drop (freshly-felled trunk) draws its per-good pickup-stage frame from the `trunk` binding via
  // the SAME per-good resolver a node uses; the DrawKind ('grounddrop', the entity) and binding key ('trunk',
  // the graphic) differ, so it is resolved explicitly rather than through the generic `bindings[kind]` lookup.
  // (resolveResourceDraw's null means an INVISIBLE level; this bare-atlas path collapses it to the
  // placeholder — the synthetic/debug sheet deliberately shows every entity. The real GPU path
  // (gpu/sprite-pool/resolve-layers.ts) draws nothing instead.)
  if (item.kind === 'grounddrop')
    return bindings.trunk === undefined ? null : (resolveResourceDraw(bindings.trunk, item)?.bob ?? null);
  const binding = bindings[item.kind];
  if (binding === undefined) return null; // kind unbound -> placeholder
  if (item.kind === 'settler')
    return resolveSettlerBobId(binding as number | SettlerStateBinding, item, tick);
  if (item.kind === 'building') return resolveBuildingDraw(binding as number | BuildingTypeBinding, item).bob;
  if (item.kind === 'resource')
    return resolveResourceDraw(binding as number | ResourceTypeBinding, item)?.bob ?? null;
  // A stump reuses the per-good resource resolver — it draws its debris frame the same way a node draws
  // its species, just from the dead-tree atlas its binding names.
  if (item.kind === 'stump')
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
 * Pure + total: a function of the item + the two tables only, no I/O or GPU. The GPU layer calls this
 * per draw item; a `null` keeps the current placeholder geometry, a frame is the atlas rect to blit.
 * This is the load-bearing data decision (which sprite) made self-verifiable; the un-self-verifiable
 * part (binding the rect to a texture and sampling pixels) stays on the GPU side for a human to judge.
 */
export function resolveSpriteFrame(
  item: DrawItem,
  bindings: SpriteBindings,
  atlas: SpriteAtlas,
  tick = 0,
): AtlasFrame | null {
  const bobId = resolveSpriteBobId(item, bindings, tick);
  if (bobId === null) return null;
  const frame = atlas.frames.get(bobId);
  // A 0-area frame is an empty/zero-size bob — treat it as unbound so the placeholder still draws.
  if (frame === undefined || frame.width === 0 || frame.height === 0) return null;
  return frame;
}
