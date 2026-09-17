import { Graphics, Sprite, type Texture } from 'pixi.js';
import { FOG_GHOST_TINT } from '../../data/fog/index.js';
import { cameraScreenX, cameraScreenY, snapToDevicePixels } from '../../data/projection/index.js';
import type { DrawItem } from '../../data/scene/index.js';
import { buildTimeThreshold, type SpriteKind } from '../../data/sprites/index.js';
import { PalettedSprite } from '../paletted-sprite/index.js';
import { DEFAULT_PIXEL_ART_SCALER } from '../pixel-art-registry.js';
import { type ShadowStyle, setCastShadowTransform } from '../shadow-style.js';
import { layerLutRow, type SpriteSheet, settlerPaletteLutRow } from '../sprite-sheet.js';
import type { TextureCache } from '../texture-cache.js';
import { setVegetationShear } from '../vegetation-sway.js';
import { worldBatched } from '../world-batcher.js';
import { BoundsUnion, createLayerDrawBox, type LayerDrawBox, layerDrawBox } from './layer-box.js';
import { drawPlaceholder, PROJECTILE_FLIGHT_HEIGHT, placeholderBounds } from './placeholder.js';
import {
  createPooled,
  type PalettedPooledEntity,
  type PlainPooledEntity,
  type PooledEntity,
} from './pooled-entity.js';
import type { ResolvedLayer } from './resolved-layer.js';
import type { PoolFrame } from './sprite-pool.js';

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

/** Assign-mode candidate-building tints, pale so they wash over the building art rather than
 *  repaint it. */
const HIGHLIGHT_OK_TINT = 0x88ff88;
const HIGHLIGHT_NO_TINT = 0xff8888;

function entityTint(ref: number, ghost: boolean, highlight?: ReadonlyMap<number, boolean>): number {
  if (ghost) return FOG_GHOST_TINT;
  const ok = highlight?.get(ref);
  if (ok === undefined) return 0xffffff;
  return ok ? HIGHLIGHT_OK_TINT : HIGHLIGHT_NO_TINT;
}

export class LayerBinder {
  /** Per-entity and per-layer scratch, so the bind pass allocates nothing. */
  private readonly layerBounds = new BoundsUnion();
  private readonly drawBox = createLayerDrawBox();

  constructor(
    private readonly textures: TextureCache,
    private readonly sheet: SpriteSheet | undefined,
  ) {}

  /** A settler is created paletted only when the player-colour LUT and the indexed characters are both
   *  loaded; animal atlases are baked recolours, never LUT-indexed. The sheet and an entity's tribe
   *  never change, so the sprite class is decided once here. */
  create(kind: SpriteKind, item: DrawItem): PooledEntity {
    const sheet = this.sheet;
    const characters = sheet?.characters;
    const isAnimal = item.tribe !== undefined && characters?.animals?.tribes.has(item.tribe) === true;
    const palette = kind === 'settler' && characters !== undefined && !isAnimal ? sheet?.palette : undefined;
    return createPooled(kind, palette);
  }

  /**
   * Bind the entity's resolved atlas layers onto its pooled sprites and stamp the union of the drawn
   * rects as its world-space bounds. `null` layers draw the placeholder marker instead.
   */
  bind(
    pe: PooledEntity,
    item: DrawItem,
    layers: ResolvedLayer[] | null,
    frame: BindFrame,
    frameId: number,
  ): void {
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
    // The (armor tier, player) LUT row - worn armor recolours the clothing bands. Unused on the plain path.
    const playerRow = pe.paletted && this.sheet !== undefined ? settlerPaletteLutRow(this.sheet, item) : 0;
    const tint = entityTint(item.ref, item.ghost === true, frame.highlight); // constant per entity
    // Feet-local union of the drawn rects: one box for mesh and plain layers alike.
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
    // A character has two shadow candidates - the projected cast and the authored `_s` foot blob - and
    // the shadow enhancement owns both. A building's authored silhouette is its only shadow, so it draws
    // whatever the enhancement says.
    const shadowStyle = frame.shadowStyle;
    const keepBlob = item.kind !== 'settler' || shadowStyle === undefined || shadowStyle.blob;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (layer === undefined) continue;
      // A cast layer holds unprojected body art, so it draws only with a style to project it by.
      if (layer.cast === true && shadowStyle?.cast !== true) continue;
      if (layer.shadow === true && layer.cast !== true && !keepBlob) continue;
      // Per-pixel reveal: a pixel appears once the eased progress, mapped into the stage's own
      // [fromPct,toPct] window, reaches its baked TimeMask threshold (the original's
      // PrintBob_UsingTimeMask construction blit). `null` - no time data or no bake - crops instead.
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
      if (pe.paletted && layer.shadow === true) {
        this.bindShadowSprite(pe, shadowSlot++, layer, box, tint, shadowStyle);
      } else if (pe.paletted) {
        const row = layerLutRow(pe.palette, layer, playerRow);
        this.bindPalettedLayer(pe, spriteSlot++, layer, originX, originY, camScale, frame, row);
      } else {
        pe.shadowFlags[spriteSlot] = layer.shadow === true;
        if (layer.cast === true && shadowStyle !== undefined) {
          this.placeShadow(this.plainSlot(pe, spriteSlot++), layer, box, tint, shadowStyle);
        } else {
          this.bindPlainLayer(pe, spriteSlot++, layer, revealTexture, box, tint, enhanceBuilding);
        }
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
    // silhouette the drawn bob has none for. The shadow flags shrink with the sprites they describe.
    if (!hasSelection) pe.selectionEllipse = undefined;
    for (let i = spriteSlot; i < pe.sprites.length; i++) {
      const s = pe.sprites[i];
      if (s !== undefined) s.visible = false;
    }
    if (pe.paletted) {
      for (let i = shadowSlot; i < pe.shadows.length; i++) {
        const s = pe.shadows[i];
        if (s !== undefined) s.visible = false;
      }
    } else {
      pe.shadowFlags.length = spriteSlot;
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
   * meshes in child order so it paints under them. It rides the container transform like every other
   * plain layer, so it follows the interpolated feet anchor the meshes place themselves from.
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
      // every one of them ahead of the meshes.
      pe.container.addChildAt(spr, slot);
    }
    this.placeShadow(spr, layer, box, tint, style);
  }

  /** A plain layer's pooled sprite, minted on the first frame that reaches this slot. */
  private plainSlot(pe: PlainPooledEntity, i: number): Sprite {
    let spr = pe.sprites[i];
    if (spr === undefined) {
      spr = worldBatched(new Sprite());
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
      spr.texture = this.textures.castSilhouette(layer.source, layer.frame);
      setCastShadowTransform(spr, layer.scale, style, box.ox, box.drawnOy);
    } else {
      spr.texture = this.textures.getShadow(layer.source, layer.frame);
      spr.skew.set(0, 0);
      spr.scale.set(layer.scale);
      spr.position.set(box.ox, box.drawnOy);
    }
    if (spr.tint !== tint) spr.tint = tint;
    spr.visible = true;
  }

  private bindPalettedLayer(
    pe: PalettedPooledEntity,
    i: number,
    layer: ResolvedLayer,
    originX: number,
    originY: number,
    camScale: number,
    frame: BindFrame,
    lutRow: number,
  ): void {
    let spr = pe.sprites[i];
    if (spr === undefined) {
      spr = new PalettedSprite(pe.palette.source, pe.palette.colours);
      pe.sprites[i] = spr;
      pe.container.addChild(spr);
    }
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
    spr.artScale = layer.scale; // retained so the portrait pass can re-place the mesh
    spr.sampling =
      frame.enhancedSampling === true ? (frame.pixelArtScaler ?? DEFAULT_PIXEL_ART_SCALER) : 'nearest';
    spr.player = lutRow;
    spr.visible = true;
  }

  private bindPlainLayer(
    pe: PlainPooledEntity,
    i: number,
    layer: ResolvedLayer,
    revealTexture: Texture | null,
    box: LayerDrawBox,
    tint: number,
    enhanceBuilding: boolean,
  ): void {
    const spr = this.plainSlot(pe, i);
    if (revealTexture === null && box.hiddenTop >= layer.frame.height) {
      // Nothing revealed yet: draw nothing, but bounds still stamp so the flat site stays clickable
      // over its plot.
      spr.visible = false;
      return;
    }
    spr.texture =
      revealTexture ??
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
      pe.placeholder = drawPlaceholder(new Graphics(), pe.kind);
      if (pe.kind === 'projectile') pe.placeholder.position.y = -PROJECTILE_FLIGHT_HEIGHT;
      pe.container.addChild(pe.placeholder);
    }
    pe.placeholder.visible = true;
    const tint = entityTint(item.ref, item.ghost === true, frame.highlight);
    if (pe.placeholder.tint !== tint) pe.placeholder.tint = tint;
    // Rotation is about the graphic's own origin, so the flight-height offset above is not rotated with
    // it: the arrow stays level over its ground anchor and only aims.
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
