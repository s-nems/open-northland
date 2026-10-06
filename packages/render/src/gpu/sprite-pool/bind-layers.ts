import { Sprite, Texture } from 'pixi.js';
import { FOG_GHOST_TINT } from '../../data/fog/index.js';
import { clamp } from '../../data/math.js';
import { cameraScreenX, cameraScreenY, snapToDevicePixels } from '../../data/projection/index.js';
import type { DrawItem } from '../../data/scene/index.js';
import { buildTimeThreshold, type SpriteKind } from '../../data/sprites/index.js';
import { PalettedQuad, PalettedSprite } from '../paletted-sprite/index.js';
import { DEFAULT_PIXEL_ART_SCALER } from '../pixel-art-registry.js';
import { mintPlanRoad, PLOT_BOUNDS, type PlanRoadTextures } from '../plan-road.js';
import { mintPlanStake, type PlanStakeTextures, STAKE_BOUNDS } from '../plan-stake.js';
import { type ShadowStyle, setCastShadowTransform } from '../shadow-style.js';
import { SelectionGraphics, SelectionSprite } from '../sprite-selection-effect.js';
import type { PaletteLut, SpriteSheet } from '../sprite-sheet.js';
import type { TextureCache } from '../texture-cache.js';
import { setVegetationShear } from '../vegetation-sway.js';
import { worldBatched } from '../world-batcher.js';
import { settlerPalette } from './character-layers.js';
import { humanLayerRow } from './human-palette-row.js';
import { BoundsUnion, createLayerDrawBox, type LayerDrawBox, layerDrawBox } from './layer-box.js';
import { drawPlaceholder, placeholderBounds } from './placeholder.js';
import {
  createPooled,
  type PalettedPooledEntity,
  type PlainPooledEntity,
  type PooledEntity,
} from './pooled-entity.js';
import type { ResolvedLayer } from './resolved-layer.js';
import type { PoolFrame } from './sprite-pool.js';
import { vehicleBodyRow, vehiclePalette } from './vehicle-palette.js';

export type BindFrame = Pick<
  PoolFrame,
  | 'camera'
  | 'screenW'
  | 'screenH'
  | 'highlight'
  | 'snapResolution'
  | 'enhancedSampling'
  | 'pixelArtScaler'
  | 'shadowStyle'
>;

/**
 * Take a layer sprite off the picture without taking it out of its band: a `visible` flip rebuilds the
 * band's instructions, while an empty texture at zero alpha draws nothing and only repacks the quad. The
 * next bind that uses the slot gives it its texture and alpha back; the picker and the selection outline
 * already pass over a zero-alpha layer. The empty texture's page lives as long as the page, so a hidden
 * layer never holds a bake that may be destroyed.
 */
function hideLayer(spr: Sprite | PalettedSprite): void {
  // A ship's mesh draws outside the batches and reframes itself on its next bind.
  if (spr instanceof PalettedSprite) {
    spr.visible = false;
    return;
  }
  if (spr.texture !== Texture.EMPTY) spr.texture = Texture.EMPTY;
  spr.alpha = 0;
}

/** Assign-mode candidate-building tints, pale so they wash over the building art rather than
 *  repaint it. */
const HIGHLIGHT_OK_TINT = 0x88ff88;
const HIGHLIGHT_NO_TINT = 0xff8888;

/** A layer's opacity at the eased build progress: opaque unless it fades out towards completion. */
function fadeAlpha(layer: ResolvedLayer, reveal: number | undefined): number {
  if (layer.fadeOutFromPct === undefined || reveal === undefined) return 1;
  const from = layer.fadeOutFromPct / 100;
  return clamp(1 - (reveal - from) / (1 - from), 0, 1);
}

/** The plan-site state a wall segment or road site binds its marker by. */
export function planSiteOf(item: DrawItem): DrawItem['palisadeSite'] | DrawItem['roadSite'] {
  return item.kind === 'palisade' ? item.palisadeSite : item.kind === 'roadsite' ? item.roadSite : undefined;
}

function entityTint(ref: number, ghost: boolean, highlight?: ReadonlyMap<number, boolean>): number {
  if (ghost) return FOG_GHOST_TINT;
  const ok = highlight?.get(ref);
  if (ok === undefined) return 0xffffff;
  return ok ? HIGHLIGHT_OK_TINT : HIGHLIGHT_NO_TINT;
}

export class LayerBinder {
  /** Per-entity and per-layer scratch, so the bind pass allocates nothing. */
  private readonly layerBounds = new BoundsUnion();
  /** Where the entity being bound stands, lifted like its drawn feet: where a grounded foot meets the
   *  ground. Its own anchor rather than the smoothed draw point, so a standing building keeps one spot. */
  private feetX = 0;
  private feetY = 0;
  private readonly drawBox = createLayerDrawBox();

  constructor(
    private readonly textures: TextureCache,
    private readonly sheet: SpriteSheet | undefined,
    private readonly stakes?: PlanStakeTextures,
    private readonly roads?: PlanRoadTextures,
  ) {}

  /** A settler is created paletted when its look is an indexed human character and the player-colour
   *  LUT is loaded; animal atlases and baked looks are never LUT-indexed. A vehicle is created paletted
   *  when its look is the indexed body, or through the settler LUT while it draws as its driver. Settlers
   *  and vehicles can change class over their lives, which {@link suits} tells the pool. */
  create(kind: SpriteKind, item: DrawItem): PooledEntity {
    return createPooled(kind, this.paletteFor(kind, item));
  }

  /** Whether `pe`'s sprite class still suits `item`: a cart turns from its own sprite into the driving
   *  figure and back as its driver boards and steps off, and a settler's look can move between an
   *  indexed and a baked atlas when its job or weapon changes. */
  suits(pe: PooledEntity, item: DrawItem): boolean {
    if (pe.kind !== 'vehicle' && pe.kind !== 'settler') return true;
    return (pe.paletted ? pe.palette : undefined) === this.paletteFor(pe.kind, item);
  }

  /**
   * Whether `pe`'s bound palette rows still serve `item` this frame. A human's row is asked for again,
   * which keeps it from eviction and recomposes it in place when the identity changed; only a moved row
   * needs a bind.
   */
  paletteHolds(pe: PooledEntity, item: DrawItem): boolean {
    if (!pe.paletted || pe.palette !== this.sheet?.palette) return true;
    return pe.humanRow.row(this.sheet, item) === pe.lutRow;
  }

  private paletteFor(kind: SpriteKind, item: DrawItem): PaletteLut | undefined {
    if (kind === 'vehicle') return vehiclePalette(this.sheet, item);
    return kind === 'settler' ? settlerPalette(this.sheet, item) : undefined;
  }

  /**
   * Bind the entity's resolved atlas layers onto its pooled sprites and stamp the union of the drawn
   * rects as its world-space bounds. `null` layers draw the placeholder marker instead.
   */
  bind(
    pe: PooledEntity,
    item: DrawItem,
    layers: readonly ResolvedLayer[] | null,
    frame: BindFrame,
    frameId: number,
  ): void {
    const site = planSiteOf(item);
    if (site === 'unclaimed') {
      this.showSiteMarker(pe, item.kind === 'roadsite', frameId);
      return;
    }
    if (pe.siteMarker !== undefined) pe.siteMarker.visible = false;
    if (site !== 'claimed' && pe.siteClaimMarker !== undefined) pe.siteClaimMarker.visible = false;
    if (layers === null) {
      pe.selectionEllipse = undefined;
      this.showPlaceholder(pe, item, frame, frameId);
      return;
    }
    if (pe.placeholder !== undefined) pe.placeholder.visible = false;
    const drawX = pe.motion.drawX;
    const drawY = pe.motion.drawY;
    // A custom-shader mesh can't ride the camera-transformed sprite layer (Pixi leaves its transform
    // UBO unbound), so it self-places in screen space from this camera-applied feet anchor. Unused on
    // the plain path.
    const camScale = frame.camera.scale ?? 1;
    const snap = frame.snapResolution;
    const originX = snapToDevicePixels(cameraScreenX(frame.camera, drawX), snap);
    const originY = snapToDevicePixels(cameraScreenY(frame.camera, drawY), snap);
    // The LUT row the body reads; a human's head reads the row after it. Unused on the plain path.
    const bodyRow = !pe.paletted
      ? 0
      : pe.kind === 'vehicle'
        ? vehicleBodyRow(this.sheet, item, pe.palette, pe.humanRow)
        : pe.humanRow.row(this.sheet, item);
    const human = pe.paletted && pe.palette === this.sheet?.palette;
    if (pe.paletted) pe.lutRow = bodyRow;
    const tint = entityTint(item.ref, item.ghost === true, frame.highlight); // constant per entity
    this.feetX = item.x;
    this.feetY = item.y - (item.lift ?? 0);
    // Feet-local union of the drawn rects: one box for paletted and plain layers alike.
    const bounds = this.layerBounds;
    bounds.reset();
    const displayReveal = pe.reveal;
    const enhanceBuilding =
      frame.enhancedSampling === true &&
      item.kind === 'building' &&
      item.builtPct === undefined &&
      item.upgradePct === undefined &&
      displayReveal === undefined;
    let hasSelection = false;
    // A paletted character's silhouettes bind onto plain sprites of their own, so `spriteSlot` counts
    // only what `pe.sprites` holds and `shadowSlot` what `pe.shadows` does.
    let spriteSlot = 0;
    let shadowSlot = 0;
    const shadowStyle = frame.shadowStyle;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (layer === undefined) continue;
      // A cast layer holds unprojected body art, so it draws only with a style to project it by.
      if (layer.cast === true && shadowStyle === undefined) continue;
      if (layer.castReplaced === true && shadowStyle !== undefined) continue;
      // A glow reads its colour from a player LUT row, which only a paletted look has.
      if (layer.glow !== undefined && !pe.paletted) continue;
      // Per-pixel reveal: a pixel appears once the eased progress, mapped into the stage's own
      // [fromPct,toPct] window, reaches its baked TimeMask threshold (the original's
      // construction reveal). `null` - no time data or no bake - crops instead.
      const revealTexture =
        layer.reveal !== undefined &&
        displayReveal !== undefined &&
        layer.times !== undefined &&
        layer.revealWindow !== undefined
          ? this.textures.revealed(
              layer.source,
              layer.frame,
              layer.times,
              buildTimeThreshold(displayReveal, layer.revealWindow[0], layer.revealWindow[1]),
              frameId,
            )
          : null;
      const box = this.drawBox;
      layerDrawBox(box, layer, displayReveal, revealTexture !== null);
      const alpha = fadeAlpha(layer, displayReveal);
      if (pe.paletted && layer.shadow === true) {
        this.bindShadowSprite(pe, shadowSlot++, layer, box, tint, shadowStyle);
      } else if (pe.paletted) {
        const row = human ? humanLayerRow(layer, bodyRow) : bodyRow;
        if (layer.glow !== undefined) {
          // The glow reads the owner's team ramp, which a human's own rolled rows may have recoloured.
          const glowRow =
            human && this.sheet?.palette !== undefined ? this.sheet.palette.teamRow(item.player ?? 0) : row;
          this.bindPalettedQuad(pe, spriteSlot++, layer, box, frame, glowRow, tint);
        } else if (pe.kind === 'vehicle') {
          this.bindPalettedMesh(pe, spriteSlot++, layer, originX, originY, camScale, frame, row, tint);
        } else {
          this.bindPalettedQuad(pe, spriteSlot++, layer, box, frame, row, tint);
        }
      } else {
        // The ground overlays spill past the body; a click on them is a click on the ground.
        pe.pickExempt[spriteSlot] = layer.shadow === true || layer.groundFoot === 'cover';
        const spr = this.plainSlot(pe, spriteSlot);
        spr.alpha = alpha;
        if (layer.cast === true) {
          this.placeShadow(spr, layer, box, tint, shadowStyle);
        } else {
          this.bindPlainLayer(spr, layer, revealTexture, box, tint, enhanceBuilding);
        }
        spriteSlot++;
      }
      if (layer.boundsExempt === true) continue;
      const selection = layer.frame.selectionEllipse;
      if (selection !== undefined && !hasSelection) {
        pe.selectionEllipse ??= { cx: 0, cy: 0, rx: 0, ry: 0 };
        const ellipse = pe.selectionEllipse;
        ellipse.cx = box.ox + selection.cx * layer.scale;
        ellipse.cy = box.oy + selection.cy * layer.scale;
        ellipse.rx = selection.rx * layer.scale;
        ellipse.ry = selection.ry * layer.scale;
        hasSelection = true;
      }
      const shearTop = box.oy * (layer.shear ?? 0);
      const shearBottom = (box.oy + box.height) * (layer.shear ?? 0);
      bounds.add(
        box.ox + Math.min(shearTop, shearBottom),
        box.oy,
        box.ox + box.width + Math.max(shearTop, shearBottom),
        box.oy + box.height,
      );
    }
    // Hide what this frame did not bind: leftover sprites from a frame that needed more layers, and a
    // silhouette the drawn bob has none for. The pick exemptions shrink with the sprites they describe.
    if (!hasSelection) pe.selectionEllipse = undefined;
    for (let i = spriteSlot; i < pe.sprites.length; i++) {
      const s = pe.sprites[i];
      if (s !== undefined) hideLayer(s);
    }
    if (pe.paletted) {
      for (let i = shadowSlot; i < pe.shadows.length; i++) {
        const s = pe.shadows[i];
        if (s !== undefined) hideLayer(s);
      }
    } else {
      pe.pickExempt.length = spriteSlot;
    }
    if (site === 'claimed') {
      const road = item.kind === 'roadsite';
      this.placeClaimMarker(pe, road);
      const marker = road ? PLOT_BOUNDS : STAKE_BOUNDS;
      bounds.add(marker.left, marker.top, marker.right, marker.bottom);
    }
    // A fog ghost stamps no bounds so it cannot be picked: its ref may be a dead entity, and selecting
    // a live one through the fog would leak its current state into the details panel.
    if (!bounds.isEmpty() && item.ghost !== true) {
      this.stampBounds(
        pe,
        drawX + bounds.minX,
        drawY + bounds.minY,
        drawX + bounds.maxX,
        drawY + bounds.maxY,
        frameId,
      );
    }
  }

  /**
   * One of a paletted character's shadow silhouettes. A silhouette carries no palette indices, so it
   * draws as a plain batched sprite - which is also what puts it on the soft-shadow bake - ahead of the
   * paletted layers in child order so it paints under them. It rides the container transform like every
   * other plain layer, so it follows the interpolated feet anchor the layers are placed from.
   */
  private bindShadowSprite(
    pe: PalettedPooledEntity,
    slot: number,
    layer: ResolvedLayer,
    box: LayerDrawBox,
    tint: number,
    style: ShadowStyle | undefined,
  ): void {
    let spr = pe.shadows[slot];
    if (spr === undefined) {
      spr = worldBatched(new Sprite());
      pe.shadows[slot] = spr;
      // Slots fill in order, so the slot index is this sprite's place among the silhouettes and keeps
      // every one of them ahead of the paletted layers.
      pe.container.addChildAt(spr, slot);
    }
    spr.alpha = 1;
    this.placeShadow(spr, layer, box, tint, style);
  }

  /** A plain layer's pooled sprite, minted on the first frame that reaches this slot. */
  private plainSlot(pe: PlainPooledEntity, i: number): SelectionSprite {
    let spr = pe.sprites[i];
    if (spr === undefined) {
      spr = worldBatched(new SelectionSprite());
      pe.sprites[i] = spr;
      pe.container.addChild(spr);
    }
    return spr;
  }

  /** An authored silhouette prints upright at its own anchor; a cast layer projects its body frame onto
   *  the ground instead. */
  private placeShadow(
    spr: Sprite,
    layer: ResolvedLayer,
    box: LayerDrawBox,
    tint: number,
    style: ShadowStyle | undefined,
  ): void {
    if (layer.cast === true && style !== undefined) {
      spr.texture = this.textures.castSilhouette(layer.source, layer.frame, layer.castRows);
      setCastShadowTransform(spr, layer.scale, style, box.ox, box.drawnOy, layer.castOriginY);
    } else {
      spr.texture = this.textures.getShadow(layer.source, layer.frame);
      spr.skew.set(0, 0);
      spr.scale.set(layer.scale);
      spr.position.set(box.ox, box.drawnOy);
    }
    if (spr.tint !== tint) spr.tint = tint;
    spr.visible = true;
  }

  /** A claimed site's ring or plot, under the builder's flag planted in its middle. An entity is a wall or
   *  a road for life, so the marker minted first stays the right one. */
  private placeClaimMarker(pe: PooledEntity, road: boolean): void {
    let marker = pe.siteClaimMarker;
    if (marker === undefined) {
      marker = road ? mintPlanRoad(this.roads, 'claimed') : mintPlanStake(this.stakes, 'ring');
      pe.siteClaimMarker = marker;
    }
    if (pe.container.children[0] !== marker) pe.container.addChildAt(marker, 0);
    marker.visible = true;
  }

  /** An unclaimed site is deliberately ground-only: no partially built post or road exists yet. */
  private showSiteMarker(pe: PooledEntity, road: boolean, frameId: number): void {
    for (const s of pe.sprites) s.visible = false;
    if (pe.paletted) for (const s of pe.shadows) s.visible = false;
    pe.selectionEllipse = undefined;
    if (pe.placeholder !== undefined) pe.placeholder.visible = false;
    if (pe.siteClaimMarker !== undefined) pe.siteClaimMarker.visible = false;
    if (pe.siteMarker === undefined) {
      pe.siteMarker = road ? mintPlanRoad(this.roads, 'open') : mintPlanStake(this.stakes, 'open');
      pe.container.addChild(pe.siteMarker);
    }
    pe.siteMarker.visible = true;
    const marker = road ? PLOT_BOUNDS : STAKE_BOUNDS;
    const drawX = pe.motion.drawX;
    const drawY = pe.motion.drawY;
    this.stampBounds(
      pe,
      drawX + marker.left,
      drawY + marker.top,
      drawX + marker.right,
      drawY + marker.bottom,
      frameId,
    );
  }

  /** A character layer: one quad of the world batch, drawn through the entity's LUT. */
  private bindPalettedQuad(
    pe: PalettedPooledEntity,
    i: number,
    layer: ResolvedLayer,
    box: LayerDrawBox,
    frame: BindFrame,
    lutRow: number,
    tint: number,
  ): void {
    const spr = palettedSlot(pe, i, PalettedQuad, () => new PalettedQuad());
    spr.texture = this.textures.palettedFrame(layer.source, layer.frame, pe.palette.source);
    spr.scale.set(layer.scale);
    spr.offsetX = box.ox;
    spr.offsetY = box.oy;
    spr.placeFor(frame.camera, pe.motion.drawX, pe.motion.drawY, frame.snapResolution);
    // The shader reads the LUT without a bounds check.
    spr.lutRow = clamp(lutRow, 0, pe.palette.colours - 1);
    spr.glow = layer.glow !== undefined;
    spr.alpha = layer.glow ?? 1;
    if (spr.tint !== tint) spr.tint = tint;
    spr.visible = true;
  }

  /** A vehicle layer: a self-placing mesh, whose shader also rolls the hull and ripples the sail. */
  private bindPalettedMesh(
    pe: PalettedPooledEntity,
    i: number,
    layer: ResolvedLayer,
    originX: number,
    originY: number,
    camScale: number,
    frame: BindFrame,
    lutRow: number,
    tint: number,
  ): void {
    const spr = palettedSlot(
      pe,
      i,
      PalettedSprite,
      () => new PalettedSprite(pe.palette.source, pe.palette.colours),
    );
    spr.setFrame(
      layer.source,
      layer.frame,
      layer.atlasW ?? layer.frame.width,
      layer.atlasH ?? layer.frame.height,
    );
    spr.place(
      originX + (layer.dx ?? 0) * camScale,
      originY + (layer.dy ?? 0) * camScale,
      camScale * layer.scale,
      frame.screenW,
      frame.screenH,
    );
    // Retained so the portrait pass can re-place the mesh and the picker can find its texels.
    spr.artScale = layer.scale;
    spr.artDx = layer.dx ?? 0;
    spr.artDy = layer.dy ?? 0;
    spr.sampling =
      frame.enhancedSampling === true ? (frame.pixelArtScaler ?? DEFAULT_PIXEL_ART_SCALER) : 'nearest';
    spr.player = lutRow;
    spr.shear = layer.shear ?? 0;
    spr.paletteTint = tint;
    spr.setClothWind(layer.cloth ?? null);
    spr.visible = true;
  }

  private bindPlainLayer(
    spr: Sprite,
    layer: ResolvedLayer,
    revealTexture: Texture | null,
    box: LayerDrawBox,
    tint: number,
    enhanceBuilding: boolean,
  ): void {
    const grounded =
      layer.groundFoot === undefined
        ? null
        : this.textures.groundedPart(
            layer.groundFoot,
            layer.source,
            layer.frame,
            layer.scale,
            this.feetX + (layer.dx ?? 0),
            this.feetY + (layer.dy ?? 0),
            enhanceBuilding,
          );
    if (layer.groundFoot === 'shade' || layer.groundFoot === 'cover') {
      if (grounded === null) {
        hideLayer(spr);
        return;
      }
      spr.texture = grounded;
      spr.position.set(box.ox, box.drawnOy);
      setVegetationShear(spr, layer.scale, 0);
      if (spr.tint !== tint) spr.tint = tint;
      return;
    }
    if (revealTexture === null && box.hiddenTop >= layer.frame.height) {
      // Nothing revealed yet; the pixel picker rejects this layer inside the retained bounds.
      hideLayer(spr);
      return;
    }
    spr.texture =
      revealTexture ??
      grounded ??
      (box.hiddenTop > 0
        ? this.textures.cropped(layer.source, layer.frame, box.hiddenTop)
        : layer.shadow === true
          ? this.textures.getShadow(layer.source, layer.frame)
          : enhanceBuilding && layer.reveal === undefined && layer.revealWindow === undefined
            ? this.textures.getBuilding(layer.source, layer.frame)
            : this.textures.get(layer.source, layer.frame));
    const shear = layer.shear ?? 0;
    spr.position.set(box.ox + box.drawnOy * shear, box.drawnOy);
    setVegetationShear(spr, layer.scale, shear);
    // The tint setter allocates even for an unchanged value, so assign only on change.
    if (spr.tint !== tint) spr.tint = tint;
    spr.visible = true;
  }

  /** Show the placeholder marker - the unbound / no-sheet fallback - and stamp the entity's bounds from
   *  its fixed body box. */
  private showPlaceholder(pe: PooledEntity, item: DrawItem, frame: BindFrame, frameId: number): void {
    for (const s of pe.sprites) s.visible = false;
    if (pe.paletted) {
      for (const s of pe.shadows) s.visible = false;
    }
    if (pe.placeholder === undefined) {
      pe.placeholder = worldBatched(new SelectionGraphics());
      drawPlaceholder(pe.placeholder, pe.kind);
      pe.container.addChild(pe.placeholder);
    }
    pe.placeholder.visible = true;
    const tint = entityTint(item.ref, item.ghost === true, frame.highlight);
    if (pe.placeholder.tint !== tint) pe.placeholder.tint = tint;
    // The arrow's flight height rides the item's lift, so rotating about its own origin only aims it.
    if (pe.kind === 'projectile') pe.placeholder.rotation = pe.motion.drawRotation;
    if (item.ghost === true) return;
    const box = placeholderBounds(pe.kind);
    const drawX = pe.motion.drawX;
    const drawY = pe.motion.drawY;
    this.stampBounds(pe, drawX + box.minX, drawY + box.minY, drawX + box.maxX, drawY + box.maxY, frameId);
  }

  /** Restamp bounds in place, so the per-frame pass allocates nothing. */
  private stampBounds(
    pe: PooledEntity,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    frameId: number,
  ): void {
    pe.bounds.minX = minX;
    pe.bounds.minY = minY;
    pe.bounds.maxX = maxX;
    pe.bounds.maxY = maxY;
    pe.boundsFrame = frameId;
  }
}

/** Slot `i`'s layer sprite, minted on the first frame that reaches it. An entity's kind fixes which class
 *  its slots hold. */
function palettedSlot<T extends PalettedQuad | PalettedSprite>(
  pe: PalettedPooledEntity,
  i: number,
  kind: abstract new (...args: never[]) => T,
  mint: () => T,
): T {
  const existing = pe.sprites[i];
  if (existing instanceof kind) return existing;
  if (existing !== undefined) throw new Error(`Paletted slot ${i} holds another layer class`);
  const spr = mint();
  pe.sprites[i] = spr;
  pe.container.addChild(spr);
  return spr;
}
