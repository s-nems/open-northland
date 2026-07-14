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
  resolveSpriteBobId,
  resolveStockpileLayerDraws,
  type SpriteKind,
} from '../../data/sprites/index.js';
import type { SettlerCharacterSet, SpriteLayer, SpriteSheet } from '../sprite-sheet.js';

/**
 * The layer-resolution step of the pool's per-frame update: which atlas layers (source + frame +
 * scale) an entity draws this frame, or `null` for the placeholder. Returns DATA instead of display
 * objects so the pool can reuse its pooled sprites. Free functions of the (immutable-per-session)
 * {@link SpriteSheet}, split from the Pixi mutation in {@link import('./sprite-pool.js').SpritePool}.
 */

/** One resolved atlas layer to draw for an entity: which source page, which frame rect, at what scale.
 *  `atlasW`/`atlasH` (the source sheet's pixel size) ride along ONLY for the paletted settler path — the
 *  {@link import('../paletted-sprite/index.js').PalettedSprite} mesh samples the indexed atlas by UV, so it needs
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
   * threshold (OpenVikings `PrintBob_UsingTimeMask`). Without time data the layer falls back to the
   * legacy bottom-up top-crop approximation.
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
   * building's ANIMATED state overlay (the mill's spinning rotor), whose per-frame rects differ in
   * size and sit off the body's centre. The bounds feed the selection ring's size/centre and the
   * details-panel portrait's fit-to-box framing; letting the spin cycle into them made the ring sit
   * off the mill and the portrait zoom in and out with the blades. The overlay still DRAWS (and still
   * pixel-hit-tests) — it just doesn't move the box.
   */
  readonly boundsExempt?: boolean;
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
  // A finished building's animated state overlay (the mill's rotor) rides along its body path — resolved
  // inside the building branch and appended to whichever body layer this frame draws. Null otherwise.
  let buildingOverlay: ResolvedLayer | null = null;
  if (item.kind === 'building') {
    // The building path either returns its own layer stack (construction rise / named-family body) or
    // falls through with a default-layer bobId + the resolved overlay — see resolveBuildingLayers.
    const branch = resolveBuildingLayers(sheet, item, tick);
    if (branch.done) return branch.layers;
    bobId = branch.bobId;
    buildingOverlay = branch.overlay;
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
    return resolveStockpileLayers(sheet, item);
  } else if (item.kind === 'grounddrop' || item.kind === 'stump' || item.kind === 'berrybush') {
    return resolveDecorLayers(sheet, item, item.kind);
  } else {
    bobId = resolveSpriteBobId(item, sheet.bindings, tick);
  }
  if (bobId === null) return null;

  const kindLayer: SpriteLayer | undefined =
    item.kind === 'tile' ? undefined : sheet.kindLayers?.[item.kind as SpriteKind];
  if (kindLayer !== undefined) {
    const frame = lookupFrame(kindLayer.atlas, bobId);
    if (frame === null) return null;
    const scale = sheet.kindScales?.[item.kind as SpriteKind] ?? 1;
    const body = { source: kindLayer.source, frame, scale };
    return buildingOverlay === null ? [body] : [body, buildingOverlay];
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
 * Resolve a building's atlas layers. An under-construction building returns its ACTIVE construction-stage
 * stack (grey foundation → stages → body, in stacking order); a finished building either returns its
 * named-family body [+ animated overlay] directly, or falls through (`done: false`) with the default
 * building-layer `bobId` so the shared body block draws it. Each stage/body resolves through the same
 * family/default-layer decision ({@link layeredLayerFor}).
 */
function resolveBuildingLayers(sheet: SpriteSheet, item: DrawItem, tick: number): BuildingBranch {
  // An under-construction building draws its construction-stage stack when the binding carries the
  // layers; a stage whose frame is missing/empty is skipped; if none resolves, fall through to the body.
  const stack = resolveConstructionDraws(sheet.bindings.building, item);
  if (stack !== null && typeof sheet.bindings.building !== 'number') {
    // Each active stage reveals as the build progresses (the pool eases the displayed value between
    // the sim's per-swing steps). A stage whose atlas carries a time sheet reveals per-pixel in its
    // own [fromPct,toPct] window — the original's model, where even the finished-house bob listed as
    // the stack's top stage materialises pixel by pixel (why house bobs carry TimeMask bytes at all).
    // Without time data a stage falls back to the bottom-up crop, and a finished building sprite is
    // excluded from that rise (it would creep up as a half-built cottage) — it snaps in at completion.
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
    // boundsExempt: the spin frames breathe in size/offset — they must not move the entity's box
    // (selection ring, portrait framing). See ResolvedLayer.boundsExempt.
    overlay = resolved === null ? null : { ...resolved, boundsExempt: true };
  }
  // A LOADED named family resolves through the shared helper (missing/empty frame → placeholder); an
  // UNLOADED one falls through to the default building layer (a deliberate difference from the
  // construction path, which drops the stage instead).
  if (draw.layer !== undefined && sheet.families?.[draw.layer] !== undefined) {
    const resolved = layeredLayerFor(sheet, 'building', draw);
    if (resolved === null) return { done: true, layers: null }; // a broken body never draws a floating overlay
    return { done: true, layers: overlay === null ? [resolved] : [resolved, overlay] };
  }
  return { done: false, bobId: draw.bob, overlay };
}

/**
 * Resolve a ground pile / delivery flag's layers. It has NO shared `kindLayers` layer of its own, so it
 * draws ONLY from a loaded named family (the `ls_goods` pile / `ls_temp` flag atlases). A bare or
 * unloaded-family ref draws the placeholder heap — never falls through to the body atlas (which would
 * blit a settler frame).
 */
function resolveStockpileLayers(sheet: SpriteSheet, item: DrawItem): ResolvedLayer[] | null {
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
}

/**
 * Resolve a decor entity's layers — a stump (`ls_trees_dead` debris), a freshly-felled trunk on the
 * ground (`landscapeToPickup` LOG) or a wild berry bush (the `ls_trees` bush frames). Like the stockpile
 * they have no shared `kindLayers` layer, so each draws its frame ONLY from a loaded named family, reusing
 * the per-good resource resolver. A bare or unloaded-family ref draws the placeholder — never a wrong-bob
 * borrow from the body atlas. Same rule, different binding key (the DrawKind names the entity, the binding
 * key names the graphic: grounddrop → `trunk`, berrybush → `berrybush`).
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
  const resolved = layeredLayerFor(sheet, kind, draw);
  return resolved === null ? null : [resolved];
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
    const frame = lookupFrame(family.atlas, draw.bob);
    if (frame === null) return null;
    const scale = sheet.familyScales?.[draw.layer] ?? sheet.kindScales?.[kind] ?? 1;
    return {
      source: family.source,
      frame,
      scale,
      // The atlas's time sheet rides along so a construction stage from this family can reveal
      // per-pixel; ignored (no reveal) on every other draw.
      ...(family.times !== undefined ? { times: family.times } : {}),
    };
  }
  const kindLayer = sheet.kindLayers?.[kind];
  if (kindLayer === undefined) return null;
  const frame = lookupFrame(kindLayer.atlas, draw.bob);
  if (frame === null) return null;
  return {
    source: kindLayer.source,
    frame,
    scale: sheet.kindScales?.[kind] ?? 1,
    ...(kindLayer.times !== undefined ? { times: kindLayer.times } : {}),
  };
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
  const bodyFrame = lookupFrame(char.body.atlas, bob);
  if (bodyFrame !== null) {
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
