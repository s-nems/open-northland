import type { TextureSource } from 'pixi.js';
import type { DrawItem } from '../../data/scene/index.js';
import {
  type AtlasFrame,
  type BuildingDraw,
  bobKey,
  finishedBuildingBobKeys,
  pickByJob,
  resolveBuildingDraw,
  resolveConstructionDraws,
  resolveResourceDraw,
  resolveSettlerBobId,
  resolveSpriteBobId,
  resolveStockpileLayerDraws,
  type SpriteKind,
} from '../../data/sprites/index.js';
import type { SettlerCharacterSet, SpriteLayer, SpriteSheet } from '../pixi-app.js';

/**
 * The layer-resolution step of the pool's per-frame update: which atlas layers (source + frame +
 * scale) an entity draws this frame, or `null` for the placeholder. Returns DATA instead of display
 * objects so the pool can reuse its pooled sprites. Free functions of the (immutable-per-session)
 * {@link SpriteSheet}, split from the Pixi mutation in {@link import('./sprite-pool.js').SpritePool}.
 */

/** One resolved atlas layer to draw for an entity: which source page, which frame rect, at what scale.
 *  `atlasW`/`atlasH` (the source sheet's pixel size) ride along ONLY for the paletted settler path — the
 *  {@link import('../paletted-sprite.js').PalettedSprite} mesh samples the indexed atlas by UV, so it needs
 *  the sheet dimensions; the plain {@link import('pixi.js').Sprite} path binds a cached sub-texture and
 *  ignores them. */
export interface ResolvedLayer {
  readonly source: TextureSource;
  readonly frame: AtlasFrame;
  readonly scale: number;
  readonly atlasW?: number;
  readonly atlasH?: number;
  /**
   * Bottom-up REVEAL fraction (0..1) — draw only the bottom `reveal` of the layer's height, cropped from
   * the top, so a growing thing rises out of the ground pixel by pixel. Present ONLY on the stage stack of
   * an under-construction building (keyed off {@link DrawItem.builtPct}); absent everywhere else (the layer
   * draws whole). The pool eases the displayed reveal toward this target so the rise is continuous between
   * the sim's per-swing `built` steps. `1` (or absent) draws the full sprite.
   *
   * source basis: a VISUAL APPROXIMATION, not the original's model. The `[GfxHouse]` `GfxBobConstructionLayer`
   * records swap WHOLE scaffold-stage bobs at `[fromPct,toPct]` thresholds (no crop field exists in the
   * format); this continuous bottom-up crop of those same stage bobs is our embellishment — tuned by eye —
   * so the frame grows smoothly instead of popping between discrete stages.
   */
  readonly reveal?: number;
}

/**
 * Compact a resolved stockpile layer stack. The first draw is required: for an empty delivery marker it is
 * the flag, and for a filled marker it is the heap. Later layers are optional overlays, so a missing flag
 * can degrade to a heap, but a missing heap must fall back to placeholder instead of rendering a full pile
 * as a bare flag.
 */
export function compactResolvedStockpileLayers<T>(layers: readonly (T | null)[]): T[] | null {
  const primary = layers[0];
  if (primary === undefined || primary === null) return null;
  const out: T[] = [primary];
  for (let i = 1; i < layers.length; i++) {
    const layer = layers[i];
    if (layer !== undefined && layer !== null) out.push(layer);
  }
  return out;
}

/**
 * Resolve the ordered atlas layers an entity draws, or `null` to draw the placeholder.
 * Faithfully reproduces the family → kind-layer → shared-body decision (an unloaded named family falls
 * through to the default building layer; a loaded family/kind layer with a missing/empty frame returns
 * `null` → placeholder, since its id space differs).
 */
export function resolveLayers(
  sheet: SpriteSheet | undefined,
  item: DrawItem,
  tick: number,
  // The MOVING-state walk-cycle clock (the pool's motion-scaled gait phase); defaults to the free
  // tick for callers without a motion track (ghost previews, tests).
  gaitClock: number = tick,
): ResolvedLayer[] | null {
  if (sheet === undefined) return null;
  // A projectile has NO decoded arrow bob (only character bodies are extracted) — it always draws the
  // pool's oriented-arrow marker, never a borrowed atlas frame. Named gap; plan step 6 hunts the
  // effects bmds once.
  if (item.kind === 'projectile') return null;

  // Per-job settler CHARACTER (the `[jobbasegraphics]` join): the job's own body + one stable head
  // pick + its own binding, resolved in that body's frame-id space. Falls through to the sheet-global
  // settler path only when the sheet carries no characters (the synthetic sheet — unchanged).
  if (item.kind === 'settler' && sheet.characters !== undefined) {
    return resolveCharacterLayers(sheet.characters, item, tick, gaitClock);
  }

  let bobId: number | null;
  if (item.kind === 'building') {
    // An under-construction building draws its ACTIVE construction-stage stack (grey foundation →
    // stages → body, several sprites in stacking order) when the binding carries the layers; each
    // stage resolves through the same family/default-layer decision a finished body uses. A stage
    // whose frame is missing/empty is skipped; if none resolves, fall through to the body draw
    // (a partial atlas degrades to the finished look rather than drawing nothing).
    const stack = resolveConstructionDraws(sheet.bindings.building, item);
    if (stack !== null && typeof sheet.bindings.building !== 'number') {
      // Under construction only the SCAFFOLDING rises: each scaffold stage is cropped to the bottom
      // `builtPct` of its height, so the timber frame grows upward as the build progresses. Any stage that
      // is a FINISHED building sprite (this or another tier's completed home bob — the stages reuse them) is
      // excluded from the rise; the real house appears only when the site completes (`builtPct` gone → the
      // normal body draw below), so it snaps in at 100% rather than a half-built cottage creeping up.
      // `builtPct` is present whenever the stack is (resolveConstructionDraws requires it); the pool eases
      // the displayed reveal so it glides between the sim's per-swing steps. At 0% the scaffold is fully
      // hidden — a fresh site shows just its grey ground plot (the ConstructionPlotLayer), and the scaffold
      // then rises from nothing as the first swings land.
      const finishedKeys = finishedBuildingBobKeys(sheet.bindings.building);
      const reveal = Math.max(0, Math.min(1, (item.builtPct ?? 0) / 100));
      const layers: ResolvedLayer[] = [];
      for (const draw of stack) {
        if (finishedKeys.has(bobKey(draw))) continue; // a finished building sprite — only at 100%
        const resolved = layeredLayerFor(sheet, 'building', draw);
        if (resolved !== null) layers.push({ ...resolved, reveal });
      }
      if (layers.length > 0) return layers;
    }
    const draw = resolveBuildingDraw(sheet.bindings.building, item);
    // A LOADED named family resolves through the shared helper (missing/empty frame → placeholder);
    // an UNLOADED one falls through to the default building layer below (a deliberate difference
    // from the construction path, which drops the stage instead).
    if (draw.layer !== undefined && sheet.families?.[draw.layer] !== undefined) {
      const resolved = layeredLayerFor(sheet, 'building', draw);
      return resolved === null ? null : [resolved];
    }
    bobId = draw.bob;
  } else if (item.kind === 'resource') {
    // A resource node resolves its per-good draw the SAME way a building does: a layer-qualified ref
    // (a rock/mine `.bmd` family) draws from that family atlas; a bare ref (the default yew) falls
    // through to the `kindLayers.resource` tree layer (or the shared synthetic atlas) below. The
    // reducer only emits a layer for a LOADED family, so a layer-qualified miss is a real gap
    // (placeholder), never a wrong-bob borrow from the tree atlas. A null draw is a data-pinned
    // INVISIBLE level (the original's freshly-sown field) — draw nothing, not the placeholder.
    const draw = resolveResourceDraw(sheet.bindings.resource, item);
    if (draw === null) return [];
    if (draw.layer !== undefined && sheet.families?.[draw.layer] !== undefined) {
      const resolved = layeredLayerFor(sheet, 'resource', draw);
      return resolved === null ? null : [resolved];
    }
    bobId = draw.bob;
  } else if (item.kind === 'stockpile') {
    // A ground pile / flag has NO shared `kindLayers` layer of its own, so it draws ONLY from a loaded
    // named family (the `ls_goods` pile / `ls_temp` flag atlases). A bare or unloaded-family ref draws
    // the placeholder heap — never falls through to the body atlas (which would blit a settler frame).
    const binding = sheet.bindings.stockpile;
    if (binding === undefined) return null;
    const draws = resolveStockpileLayerDraws(binding, item);
    return compactResolvedStockpileLayers(
      draws.map((draw) =>
        draw.layer === undefined
          ? null // no family -> placeholder heap/flag, never a wrong atlas borrow
          : layeredLayerFor(sheet, 'stockpile', draw),
      ),
    );
  } else if (item.kind === 'grounddrop' || item.kind === 'stump') {
    // A stump (`ls_trees_dead` debris) and a freshly-felled trunk on the ground (`landscapeToPickup`
    // LOG) have no shared `kindLayers` layer either — each draws its per-good frame ONLY from a loaded
    // named family, reusing the per-good resource resolver. A bare or unloaded-family ref draws the
    // placeholder — never a wrong-bob borrow from the body atlas. Same rule, different binding key
    // (the DrawKind names the entity, the binding key names the graphic: grounddrop → `trunk`).
    const binding = item.kind === 'stump' ? sheet.bindings.stump : sheet.bindings.trunk;
    if (binding === undefined) return null;
    const draw = resolveResourceDraw(binding, item);
    if (draw === null) return []; // a data-pinned invisible level — draw nothing, not the placeholder
    if (draw.layer === undefined) return null; // no family → placeholder
    const resolved = layeredLayerFor(sheet, item.kind, draw);
    return resolved === null ? null : [resolved];
  } else {
    bobId = resolveSpriteBobId(item, sheet.bindings, tick);
  }
  if (bobId === null) return null;

  const kindLayer: SpriteLayer | undefined =
    item.kind === 'tile' ? undefined : sheet.kindLayers?.[item.kind as SpriteKind];
  if (kindLayer !== undefined) {
    const frame = kindLayer.atlas.frames.get(bobId);
    if (frame === undefined || frame.width === 0 || frame.height === 0) return null;
    const scale = sheet.kindScales?.[item.kind as SpriteKind] ?? 1;
    return [{ source: kindLayer.source, frame, scale }];
  }

  // Shared body atlas + overlay (head) layers, all indexed by the same resolved bob id.
  const id = bobId;
  const layers: ResolvedLayer[] = [];
  const add = (layer: SpriteLayer): void => {
    const frame = layer.atlas.frames.get(id);
    if (frame !== undefined && frame.width > 0 && frame.height > 0) {
      layers.push({ source: layer.source, frame, scale: 1 });
    }
  };
  add({ source: sheet.source, atlas: sheet.atlas });
  for (const overlay of sheet.overlays ?? []) add(overlay);
  return layers.length > 0 ? layers : null;
}

/**
 * Resolve ONE layered draw (a finished building body / construction stage, or a per-good resource /
 * stockpile object) to its atlas layer — the family / dedicated-kind-layer decision shared by every
 * layered kind. A `draw.layer` draws from that named {@link SpriteSheet.families} atlas (at its
 * `familyScales` entry, else the kind's `kindScales`, else native); a bare draw draws from the kind's
 * own {@link SpriteSheet.kindLayers} layer. Returns null for an unloaded family, a kind with no
 * dedicated layer, or a missing/empty frame (the caller skips or falls back to the placeholder).
 */
function layeredLayerFor(sheet: SpriteSheet, kind: SpriteKind, draw: BuildingDraw): ResolvedLayer | null {
  if (draw.layer !== undefined) {
    const family = sheet.families?.[draw.layer];
    if (family === undefined) return null; // unloaded named family — no wrong-bob borrow
    const frame = family.atlas.frames.get(draw.bob);
    if (frame === undefined || frame.width === 0 || frame.height === 0) return null;
    const scale = sheet.familyScales?.[draw.layer] ?? sheet.kindScales?.[kind] ?? 1;
    return { source: family.source, frame, scale };
  }
  const kindLayer = sheet.kindLayers?.[kind];
  if (kindLayer === undefined) return null;
  const frame = kindLayer.atlas.frames.get(draw.bob);
  if (frame === undefined || frame.width === 0 || frame.height === 0) return null;
  return { source: kindLayer.source, frame, scale: sheet.kindScales?.[kind] ?? 1 };
}

/**
 * Resolve a per-job settler CHARACTER's layers: the job's own body frame plus ONE stable head overlay
 * per individual (picked by entity id — ids are monotonic, never reused — so a crowd shows varied faces
 * without per-frame flicker, the render-side analogue of the original's per-individual random head).
 * The head may resolve through its OWN binding (the head-borrow case — a carry variant whose head bobs
 * are empty plays the base walk's head instead).
 */
function resolveCharacterLayers(
  characters: SettlerCharacterSet,
  item: DrawItem,
  tick: number,
  gaitClock: number,
): ResolvedLayer[] | null {
  const char = pickByJob(characters, item.jobType, item.young === true, item.weaponGood);
  const bob = resolveSettlerBobId(char.binding, item, tick, gaitClock);
  const layers: ResolvedLayer[] = [];
  const bodyFrame = char.body.atlas.frames.get(bob);
  if (bodyFrame !== undefined && bodyFrame.width > 0 && bodyFrame.height > 0) {
    // atlasW/H ride along for the paletted mesh path (it samples the indexed sheet by UV); the plain
    // sprite path ignores them. See ResolvedLayer.
    layers.push({
      source: char.body.source,
      frame: bodyFrame,
      scale: 1,
      atlasW: char.body.atlas.width,
      atlasH: char.body.atlas.height,
    });
  }
  const heads = char.heads;
  if (heads !== undefined && heads.length > 0) {
    const head = heads[item.ref % heads.length];
    const headBob =
      char.headBinding !== undefined ? resolveSettlerBobId(char.headBinding, item, tick, gaitClock) : bob;
    const headFrame = head?.atlas.frames.get(headBob);
    if (head !== undefined && headFrame !== undefined && headFrame.width > 0 && headFrame.height > 0) {
      layers.push({
        source: head.source,
        frame: headFrame,
        scale: 1,
        atlasW: head.atlas.width,
        atlasH: head.atlas.height,
      });
    }
  }
  return layers.length > 0 ? layers : null;
}
