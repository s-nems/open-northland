import type { TextureSource } from 'pixi.js';
import { clamp01 } from '../../data/math.js';
import type { DrawItem } from '../../data/scene/index.js';
import {
  type AtlasFrame,
  type BuildingDraw,
  type BuildTimeSheet,
  bobKey,
  finishedBuildingBobKeys,
  lookupFrame,
  pickByJob,
  resolveBuildingDraw,
  resolveBuildingOverlayDraw,
  resolveConstructionDraws,
  resolveResourceDraw,
  resolveSettlerBobId,
  resolveSignpostDraw,
  resolveSpriteBobId,
  resolveStockpileDraw,
  type SpriteKind,
} from '../../data/sprites/index.js';
import type { SettlerCharacterSet, SpriteLayer, SpriteSheet } from '../sprite-sheet.js';

/**
 * The layer-resolution step of the pool's per-frame update: which atlas layers (source + frame +
 * scale) an entity draws this frame, or `null` for the placeholder. Returns data instead of display
 * objects so the pool can reuse its pooled sprites. Free functions of the immutable-per-session
 * {@link SpriteSheet}.
 */

/** One resolved atlas layer to draw for an entity: which source page, which frame rect, at what scale.
 *  `atlasW`/`atlasH` (the source sheet's pixel size) ride along only for the paletted settler path — the
 *  {@link import('../paletted-sprite/index.js').PalettedSprite} mesh samples the indexed atlas by UV and needs
 *  the sheet dimensions; the plain {@link import('pixi.js').Sprite} path binds a cached sub-texture and
 *  ignores them. */
export interface ResolvedLayer {
  readonly source: TextureSource;
  readonly frame: AtlasFrame;
  readonly scale: number;
  readonly atlasW?: number;
  readonly atlasH?: number;
  /**
   * Construction reveal fraction (0..1 of `builtPct/100`) — present only on the stage stack of an
   * under-construction building; the pool eases the displayed value toward it between the sim's
   * per-swing `built` steps. With {@link times} (+ {@link revealWindow}) the reveal is per-pixel:
   * each pixel appears once the eased progress, mapped into the window
   * ({@link import('../../data/sprites/index.js').buildTimeThreshold}), reaches its baked TimeMask
   * threshold. Without time data the layer falls back to the
   * bottom-up top-crop approximation.
   */
  readonly reveal?: number;
  /** The atlas's build-progress time sheet, when the loaded {@link import('../sprite-sheet.js').SpriteLayer}
   *  carries one — enables the per-pixel reveal (see {@link reveal}). */
  readonly times?: BuildTimeSheet;
  /** The construction stage's `[fromPct, toPct]` progress window — set with {@link times} on a reveal
   *  layer so the pool can map eased progress into this stage's own threshold scale. */
  readonly revealWindow?: readonly [number, number];
  /**
   * Excluded from the entity's stamped {@link import('./pooled-entity.js').EntityBounds} — set on a
   * building's animated state overlay (the mill's spinning rotor), whose per-frame rects differ in
   * size and sit off the body's centre. The bounds feed the selection ring's size/centre and the
   * details-panel portrait's fit-to-box framing, which must not breathe with the spin cycle. The
   * overlay still draws and still pixel-hit-tests — it just doesn't move the box.
   */
  readonly boundsExempt?: boolean;
  /**
   * A cast-shadow layer ({@link shadowLayerFor}) — always also {@link boundsExempt}, and additionally
   * excluded from the pixel hit test: clicking the darkened ground beside a caster must not select it
   * (unlike the rotor overlay, which is a clickable part of the building).
   */
  readonly shadow?: true;
}

/**
 * Resolve the cast-shadow layer a drawn bob prepends under itself: the same bob id looked up in the
 * source layer's {@link SpriteLayer.shadow} twin (shadow bob sets parallel their body's ids — observed
 * on the tree and house `_s.bmd`s). Null when the layer has no shadow twin or the twin holds no visible
 * frame at that id (most bobs cast none — the data decides).
 */
function shadowLayerFor(layer: SpriteLayer, bobId: number, scale: number): ResolvedLayer | null {
  const shadow = layer.shadow;
  if (shadow === undefined) return null;
  const frame = lookupFrame(shadow.atlas, bobId);
  if (frame === null) return null;
  return { source: shadow.source, frame, scale, boundsExempt: true, shadow: true };
}

/**
 * Resolve the ordered atlas layers an entity draws, or `null` to draw the placeholder — the family →
 * kind-layer → shared-body decision. A loaded family/kind layer with a missing or empty frame returns
 * `null` rather than borrowing a frame from another layer, since their id spaces differ.
 */
export function resolveLayers(
  sheet: SpriteSheet | undefined,
  item: DrawItem,
  tick: number,
  // The moving-state walk-cycle clock (the pool's motion-scaled gait phase); defaults to the free
  // tick for callers without a motion track (ghost previews, tests).
  gaitClock: number = tick,
): ResolvedLayer[] | null {
  if (sheet === undefined) return null;
  // A projectile has no decoded arrow bob (only character bodies are extracted) — it always draws the
  // pool's oriented-arrow marker, never a borrowed atlas frame (named gap).
  if (item.kind === 'projectile') return null;

  // Per-job settler character (the `[jobbasegraphics]` join): the job's own body + one stable head
  // pick + its own binding, resolved in that body's frame-id space. Falls through to the sheet-global
  // settler path only when the sheet carries no characters (the synthetic sheet).
  if (item.kind === 'settler' && sheet.characters !== undefined) {
    return resolveCharacterLayers(sheet.characters, item, tick, gaitClock);
  }

  let bobId: number | null;
  // A finished building's animated state overlay (the mill's rotor) rides along its body path — resolved
  // inside the building branch and appended to whichever body layer this frame draws. Null otherwise.
  let buildingOverlay: ResolvedLayer | null = null;
  if (item.kind === 'building') {
    const branch = resolveBuildingLayers(sheet, item, tick);
    if (branch.done) return branch.layers;
    bobId = branch.bobId;
    buildingOverlay = branch.overlay;
  } else if (item.kind === 'resource') {
    // A resource node resolves its per-good draw the same way a building does: a layer-qualified ref
    // (a rock/mine `.bmd` family) draws from that family atlas; a bare ref (the default yew) falls
    // through to the `kindLayers.resource` tree layer (or the shared synthetic atlas) below. The
    // reducer only emits a layer for a loaded family, so a layer-qualified miss is a real gap
    // (placeholder), never a wrong-bob borrow from the tree atlas. A null draw is a data-pinned
    // invisible level (the original's freshly-sown field) — draw nothing, not the placeholder.
    const draw = resolveResourceDraw(sheet.bindings.resource, item);
    if (draw === null) return [];
    if (draw.layer !== undefined && sheet.families?.[draw.layer] !== undefined) {
      return layeredLayersWithShadow(sheet, 'resource', draw);
    }
    bobId = draw.bob;
  } else if (item.kind === 'stockpile') {
    return resolveStockpileLayers(sheet, item);
  } else if (item.kind === 'signpost') {
    // A signpost (post or one of its direction boards) draws its layer-qualified frame from the
    // guidepost family atlas. Every signpost ref IS layer-qualified (human-sheet emits the binding only
    // for loaded families), so a missing family here is a placeholder, never a bare-bob fall-through
    // into the shared body atlas (a human frame drawn as a post).
    const draw = resolveSignpostDraw(sheet.bindings.signpost, item);
    if (draw === null || draw.layer === undefined || sheet.families?.[draw.layer] === undefined) {
      return null;
    }
    const resolved = layeredLayerFor(sheet, 'signpost', draw);
    return resolved === null ? null : [resolved];
  } else if (item.kind === 'grounddrop' || item.kind === 'stump' || item.kind === 'berrybush') {
    return resolveDecorLayers(sheet, item, item.kind);
  } else {
    bobId = resolveSpriteBobId(item, sheet.bindings, tick);
  }
  if (bobId === null) return null;

  const kindLayer: SpriteLayer | undefined = item.kind === 'tile' ? undefined : sheet.kindLayers?.[item.kind];
  if (kindLayer !== undefined && item.kind !== 'tile') {
    const frame = lookupFrame(kindLayer.atlas, bobId);
    if (frame === null) return null;
    const scale = sheet.kindScales?.[item.kind] ?? 1;
    const shadow = shadowLayerFor(kindLayer, bobId, scale);
    const layers: ResolvedLayer[] = shadow === null ? [] : [shadow];
    layers.push({ source: kindLayer.source, frame, scale });
    if (buildingOverlay !== null) layers.push(buildingOverlay);
    return layers;
  }

  // Shared body atlas + overlay (head) layers, all indexed by the same resolved bob id.
  const id = bobId;
  const layers: ResolvedLayer[] = [];
  const add = (layer: SpriteLayer): void => {
    const frame = lookupFrame(layer.atlas, id);
    if (frame !== null) {
      layers.push({ source: layer.source, frame, scale: 1 });
    }
  };
  add({ source: sheet.source, atlas: sheet.atlas });
  for (const overlay of sheet.overlays ?? []) add(overlay);
  return layers.length > 0 ? layers : null;
}

/** The building branch's outcome: either a finished stack it resolved on its own (`done`), or a
 *  fall-through carrying the default-layer `bobId` + resolved overlay for the shared body block. */
type BuildingBranch =
  | { readonly done: true; readonly layers: ResolvedLayer[] | null }
  | { readonly done: false; readonly bobId: number; readonly overlay: ResolvedLayer | null };

/**
 * Resolve a building's atlas layers. An under-construction building returns its active construction-stage
 * stack (grey foundation → stages → body, in stacking order); a finished building either returns its
 * named-family body [+ animated overlay] directly, or falls through (`done: false`) with the default
 * building-layer `bobId` so the shared body block draws it. Each stage/body resolves through the same
 * family/default-layer decision ({@link layeredLayerFor}).
 */
function resolveBuildingLayers(sheet: SpriteSheet, item: DrawItem, tick: number): BuildingBranch {
  // A stage whose frame is missing/empty is skipped; if no stage resolves, fall through to the body.
  const stack = resolveConstructionDraws(sheet.bindings.building, item);
  if (stack !== null && typeof sheet.bindings.building !== 'number') {
    // Each active stage reveals as the build progresses (the pool eases the displayed value between
    // the sim's per-swing steps). A stage whose atlas carries a time sheet reveals per-pixel in its
    // own [fromPct,toPct] window — the original's model, where even the finished-house bob listed as
    // the stack's top stage materialises pixel by pixel. Without time data a stage falls back to the
    // bottom-up crop, and a finished building sprite is excluded from that rise (it would creep up as
    // a half-built cottage) — it snaps in at completion.
    const finishedKeys = finishedBuildingBobKeys(sheet.bindings.building);
    const reveal = clamp01((item.builtPct ?? 0) / 100);
    const layers: ResolvedLayer[] = [];
    for (const draw of stack) {
      const resolved = layeredLayerFor(sheet, 'building', draw);
      if (resolved === null) continue;
      if (resolved.times !== undefined) {
        layers.push({ ...resolved, reveal, revealWindow: [draw.fromPct, draw.toPct] });
      } else if (!finishedKeys.has(bobKey(draw))) {
        layers.push({ ...resolved, reveal });
      }
    }
    if (layers.length > 0) return { done: true, layers };
  }
  const draw = resolveBuildingDraw(sheet.bindings.building, item);
  const overlayDraw = resolveBuildingOverlayDraw(sheet.bindings.building, item, tick);
  let overlay: ResolvedLayer | null = null;
  if (overlayDraw !== null) {
    const resolved = layeredLayerFor(sheet, 'building', overlayDraw);
    // The spin frames must not move the entity's box — see ResolvedLayer.boundsExempt.
    overlay = resolved === null ? null : { ...resolved, boundsExempt: true };
  }
  // A loaded named family resolves through the shared helper (missing/empty frame → placeholder); an
  // unloaded one falls through to the default building layer (a deliberate difference from the
  // construction path, which drops the stage instead).
  if (draw.layer !== undefined && sheet.families?.[draw.layer] !== undefined) {
    const layers = layeredLayersWithShadow(sheet, 'building', draw);
    if (layers === null) return { done: true, layers: null }; // a broken body never draws a floating overlay
    if (overlay !== null) layers.push(overlay);
    return { done: true, layers };
  }
  return { done: false, bobId: draw.bob, overlay };
}

/**
 * Resolve a ground pile / delivery flag's layers. It has no shared `kindLayers` layer of its own, so it
 * draws only from a loaded named family (the `ls_goods` pile / `ls_temp` flag atlases); a bare or
 * unloaded-family ref draws the placeholder heap. Each layer prepends its cast shadow like every other
 * kind (`ls_goods_s` holds a silhouette for every pile bob in the owned copy).
 */
function resolveStockpileLayers(sheet: SpriteSheet, item: DrawItem): ResolvedLayer[] | null {
  const binding = sheet.bindings.stockpile;
  if (binding === undefined) return null;
  // A stockpile draws a single graphic — its heap or its delivery flag; piles never stack layers.
  const draw = resolveStockpileDraw(binding, item);
  if (draw.layer === undefined) return null; // no family -> placeholder heap/flag, never a wrong atlas borrow
  return layeredLayersWithShadow(sheet, 'stockpile', draw);
}

/**
 * Resolve a decor entity's layers — a stump (`ls_trees_dead` debris), a freshly-felled trunk on the
 * ground (`landscapeToPickup` LOG) or a wild berry bush (the `ls_trees` bush frames). Like the stockpile
 * they have no shared `kindLayers` layer, so each draws only from a loaded named family (else the
 * placeholder), reusing the per-good resource resolver. The DrawKind names the entity, the binding key
 * names the graphic: grounddrop → `trunk`, berrybush → `berrybush`.
 */
function resolveDecorLayers(
  sheet: SpriteSheet,
  item: DrawItem,
  kind: 'grounddrop' | 'stump' | 'berrybush',
): ResolvedLayer[] | null {
  const binding =
    kind === 'stump'
      ? sheet.bindings.stump
      : kind === 'berrybush'
        ? sheet.bindings.berrybush
        : sheet.bindings.trunk;
  if (binding === undefined) return null;
  const draw = resolveResourceDraw(binding, item);
  if (draw === null) return []; // a data-pinned invisible level — draw nothing, not the placeholder
  if (draw.layer === undefined) return null; // no family → placeholder
  return layeredLayersWithShadow(sheet, kind, draw);
}

/**
 * {@link layeredLayerFor} plus the body's cast shadow: `[shadow, body]` when the draw's source layer
 * carries a {@link SpriteLayer.shadow} twin with a visible frame at the same bob id, else `[body]`;
 * null exactly when {@link layeredLayerFor} is. The construction stack keeps {@link layeredLayerFor}
 * directly — its stage shadows are a separate lane (the `shadowBobId` ticket).
 */
function layeredLayersWithShadow(
  sheet: SpriteSheet,
  kind: SpriteKind,
  draw: BuildingDraw,
): ResolvedLayer[] | null {
  const layer = sourceLayerFor(sheet, kind, draw);
  if (layer === undefined) return null;
  const body = resolveFromLayer(layer, sheet, kind, draw);
  if (body === null) return null;
  const shadow = shadowLayerFor(layer, draw.bob, body.scale);
  return shadow === null ? [body] : [shadow, body];
}

/**
 * Resolve one layered draw (a finished building body / construction stage, or a per-good resource /
 * stockpile object) to its atlas layer — the family / dedicated-kind-layer decision shared by every
 * layered kind. Returns null for an unloaded family, a kind with no dedicated layer, or a
 * missing/empty frame (the caller skips or falls back to the placeholder).
 */
function layeredLayerFor(sheet: SpriteSheet, kind: SpriteKind, draw: BuildingDraw): ResolvedLayer | null {
  const layer = sourceLayerFor(sheet, kind, draw);
  return layer === undefined ? null : resolveFromLayer(layer, sheet, kind, draw);
}

/**
 * The source atlas layer a layered draw reads: a `draw.layer` names a {@link SpriteSheet.families}
 * atlas, a bare draw uses the kind's own {@link SpriteSheet.kindLayers} layer. An unloaded named
 * family is `undefined` — never a wrong-bob borrow from the kind layer (their id spaces differ).
 */
function sourceLayerFor(sheet: SpriteSheet, kind: SpriteKind, draw: BuildingDraw): SpriteLayer | undefined {
  return draw.layer !== undefined ? sheet.families?.[draw.layer] : sheet.kindLayers?.[kind];
}

/** {@link layeredLayerFor}'s frame/scale step over an already-picked source layer: the draw's bob frame
 *  at the family's `familyScales` entry, else the kind's `kindScales`, else native. The atlas's time
 *  sheet rides along so a construction stage can reveal per-pixel; ignored on every other draw. */
function resolveFromLayer(
  layer: SpriteLayer,
  sheet: SpriteSheet,
  kind: SpriteKind,
  draw: BuildingDraw,
): ResolvedLayer | null {
  const frame = lookupFrame(layer.atlas, draw.bob);
  if (frame === null) return null;
  const scale =
    (draw.layer !== undefined ? sheet.familyScales?.[draw.layer] : undefined) ??
    sheet.kindScales?.[kind] ??
    1;
  return {
    source: layer.source,
    frame,
    scale,
    ...(layer.times !== undefined ? { times: layer.times } : {}),
  };
}

/**
 * Resolve a per-job settler character's layers: the job's own body frame plus one stable head overlay
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
  const bodyFrame = lookupFrame(char.body.atlas, bob);
  if (bodyFrame !== null) {
    // atlasW/H ride along for the paletted mesh path — see ResolvedLayer.
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
    const headFrame = head === undefined ? null : lookupFrame(head.atlas, headBob);
    if (head !== undefined && headFrame !== null) {
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
