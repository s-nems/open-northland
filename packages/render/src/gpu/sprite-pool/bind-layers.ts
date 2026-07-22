import { Graphics, Sprite, type Texture } from 'pixi.js';
import { FOG_GHOST_TINT } from '../../data/fog/index.js';
import { cameraScreenX, cameraScreenY } from '../../data/projection/index.js';
import type { DrawItem } from '../../data/scene/index.js';
import { buildTimeThreshold, type SpriteKind } from '../../data/sprites/index.js';
import { PalettedSprite } from '../paletted-sprite/index.js';
import type { SpriteSheet } from '../sprite-sheet.js';
import type { TextureCache } from '../texture-cache.js';
import { BoundsUnion, createLayerDrawBox, type LayerDrawBox, layerDrawBox } from './layer-box.js';
import { drawPlaceholder, PROJECTILE_FLIGHT_HEIGHT, placeholderBounds } from './placeholder.js';
import {
  createPooled,
  type PalettedPooledEntity,
  type PlainPooledEntity,
  type PooledEntity,
} from './pooled-entity.js';
import type { ResolvedLayer } from './resolve-layers.js';
import type { PoolFrame } from './sprite-pool.js';

/**
 * The per-entity binding half of the sprite pool: mutate one {@link PooledEntity}'s display objects to
 * this frame's resolved layers (or its placeholder) and stamp its drawn bounds.
 */

/** The slice of the pool's per-frame {@link PoolFrame} the binder reads (each field's contract lives
 *  there). */
export type BindFrame = Pick<PoolFrame, 'camera' | 'screenW' | 'screenH' | 'highlight'>;

/** The faint tints an assign-mode candidate building draws with — a light green when the settler can be
 *  assigned there, a light red when not. Pale (near-white) so it reads as a wash over the building art
 *  rather than repainting it. */
const HIGHLIGHT_OK_TINT = 0x88ff88;
const HIGHLIGHT_NO_TINT = 0xff8888;

/** The tint a drawn entity takes this frame: the fog-ghost grey when ghosted, else the assign-mode
 *  green/red when it is a highlighted candidate building, else none (white). */
function entityTint(ref: number, ghost: boolean, highlight?: ReadonlyMap<number, boolean>): number {
  if (ghost) return FOG_GHOST_TINT;
  const ok = highlight?.get(ref);
  if (ok === undefined) return 0xffffff;
  return ok ? HIGHLIGHT_OK_TINT : HIGHLIGHT_NO_TINT;
}

export class LayerBinder {
  /** Scratch accumulator for the drawn layers' box union, reset per entity so the bounds pass allocates
   *  nothing. Never read outside the {@link bind} call that fills it. */
  private readonly layerBounds = new BoundsUnion();
  /** Scratch for the layer geometry of the sprite being bound — refilled per layer, never retained. */
  private readonly drawBox = createLayerDrawBox();

  constructor(
    private readonly textures: TextureCache,
    private readonly sheet: SpriteSheet | undefined,
  ) {}

  /** A fresh pooled entity of `kind`. A settler with both the player-colour LUT and the indexed
   *  characters loaded (real graphics + the pipeline's colour stage) is created paletted, carrying the
   *  LUT its meshes bind through; the sheet never changes, so the sprite class is decided once here. */
  create(kind: SpriteKind): PooledEntity {
    const sheet = this.sheet;
    const palette = kind === 'settler' && sheet?.characters !== undefined ? sheet.palette : undefined;
    return createPooled(kind, palette);
  }

  /**
   * Bind the entity's resolved atlas layers onto its pooled sprites (growing the sprite list only when a
   * frame needs more layers than any before), and stamp the union of the drawn rects as the entity's
   * world-space bounds. `null` layers draw the placeholder marker instead. A paletted settler binds
   * {@link PalettedSprite} meshes (screen-space, self-placed); every other entity binds plain cached
   * sub-textures.
   */
  bind(
    pe: PooledEntity,
    item: DrawItem,
    layers: ResolvedLayer[] | null,
    frame: BindFrame,
    frameId: number,
  ): void {
    if (layers === null) {
      this.showPlaceholder(pe, item, frame, frameId);
      return;
    }
    if (pe.placeholder !== undefined) pe.placeholder.visible = false;
    const drawX = pe.motion.drawX;
    const drawY = pe.motion.drawY;
    // A custom-shader mesh can't ride the camera-transformed spriteLayer (Pixi leaves its transform UBO
    // unbound), so it self-places in screen space — mirror the camera the plain sprites inherit: screen
    // feet-anchor = camera applied to this entity's drawn (lerped) anchor. Unused on the plain path.
    const camScale = frame.camera.scale ?? 1;
    const originX = cameraScreenX(frame.camera, drawX);
    const originY = cameraScreenY(frame.camera, drawY);
    const playerRow = item.player ?? 0; // an unowned settler reads LUT row 0 (the base palette)
    const tint = entityTint(item.ref, item.ghost === true, frame.highlight); // constant per entity
    // Accumulate the union of the drawn layers' rects (feet-local) → the entity's exact sprite bounds,
    // for a mesh or a plain sprite alike, so the picker/selection ring reads one consistent box
    // regardless of how the layer was drawn.
    const bounds = this.layerBounds;
    bounds.reset();
    // The eased reveal the active stages were selected from (see {@link
    // import('./presentation.js').easeReveal}), so the per-pixel reveal below cannot disagree with them.
    const displayReveal = pe.reveal;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (layer === undefined) continue;
      // Restamped per frame beside the sprite itself: the pixel hit test must skip a cast-shadow layer
      // (clicking darkened ground beside a caster is not clicking the caster).
      pe.shadowFlags[i] = layer.shadow === true;
      // A reveal layer with time data draws per-pixel: each pixel appears in place once the eased
      // progress, mapped into the stage's own [fromPct,toPct] window, reaches its baked TimeMask
      // threshold (the original's PrintBob_UsingTimeMask construction blit). `null` — no time data or
      // no bake (headless, unreadable atlas pixels) — draws the bottom-up crop below instead. Buildings
      // never take the paletted path.
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
      // Feet-local placement + the crop-reveal geometry (see {@link layerDrawBox}).
      const box = this.drawBox;
      layerDrawBox(box, layer, displayReveal, revealTexture !== null);
      if (pe.paletted) {
        this.bindPalettedLayer(pe, i, layer, originX, originY, camScale, frame, playerRow);
      } else {
        this.bindPlainLayer(pe, i, layer, revealTexture, box, tint);
      }
      // An animated state overlay (the mill's rotor) draws but never moves the entity's box — its spin
      // frames breathe in size/offset, and the box feeds the selection ring + portrait framing.
      if (layer.boundsExempt === true) continue;
      bounds.add(box.ox, box.oy, box.ox + box.width, box.oy + box.height);
    }
    // Hide any leftover sprites from a frame that needed more layers than this one, and drop their
    // stale shadow flags with them (pixelHit skips hidden sprites, but the flag array must not
    // outlive the layers it described).
    pe.shadowFlags.length = layers.length;
    for (let i = layers.length; i < pe.sprites.length; i++) {
      const s = pe.sprites[i];
      if (s !== undefined) s.visible = false;
    }
    // A fog ghost stamps no bounds: it must not be pickable — the ref may be a dead entity, and
    // click-selecting a live one through the fog would leak its current state into the details panel.
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

  /** One team-coloured mesh layer. The mesh samples the indexed atlas by UV, so it needs the sheet size;
   *  the frame's own draw offset is baked into its quad, and place() maps native pixels → screen at the
   *  camera zoom (× the layer art scale) about the feet anchor. `playerRow` selects the LUT row. */
  private bindPalettedLayer(
    pe: PalettedPooledEntity,
    i: number,
    layer: ResolvedLayer,
    originX: number,
    originY: number,
    camScale: number,
    frame: BindFrame,
    playerRow: number,
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
    spr.place(originX, originY, camScale * layer.scale, frame.screenW, frame.screenH);
    spr.artScale = layer.scale; // retained so `placePalettedFor` can re-place for the portrait inset
    spr.player = playerRow;
    spr.visible = true;
  }

  /** One plain cached-sub-texture layer at its feet-local box, with the frame's reveal/crop and tint. */
  private bindPlainLayer(
    pe: PlainPooledEntity,
    i: number,
    layer: ResolvedLayer,
    revealTexture: Texture | null,
    box: LayerDrawBox,
    tint: number,
  ): void {
    let spr = pe.sprites[i];
    if (spr === undefined) {
      spr = new Sprite();
      pe.sprites[i] = spr;
      pe.container.addChild(spr);
    }
    if (revealTexture === null && box.hiddenTop >= layer.frame.height) {
      // Nothing revealed yet (a foundation at 0%): draw nothing this frame — but bounds still stamp,
      // so the flat site stays clickable over its plot.
      spr.visible = false;
      return;
    }
    spr.texture =
      revealTexture ??
      (box.hiddenTop > 0
        ? this.textures.cropped(layer.source, layer.frame, box.hiddenTop)
        : this.textures.get(layer.source, layer.frame));
    spr.position.set(box.ox, box.drawnOy);
    spr.scale.set(layer.scale);
    // A fog ghost dims to the explored-grey grading; assigned unconditionally so a sprite reused
    // across the live↔ghost transition always carries the right tint (tint is a cheap batch
    // attribute — ghosts are never paletted, statics don't take the mesh path).
    spr.tint = tint;
    spr.visible = true;
  }

  /** Show (lazily building) the placeholder marker — the unbound / no-sheet fallback — and stamp the
   *  entity's bounds from the placeholder's fixed body box. Any atlas sprites are hidden. A projectile
   *  always draws this path (no decoded arrow bob exists): its arrow flies at body height and rotates
   *  to the item's flight heading each frame. */
  private showPlaceholder(pe: PooledEntity, item: DrawItem, frame: BindFrame, frameId: number): void {
    for (const s of pe.sprites) s.visible = false;
    if (pe.placeholder === undefined) {
      pe.placeholder = drawPlaceholder(new Graphics(), pe.kind);
      if (pe.kind === 'projectile') pe.placeholder.position.y = -PROJECTILE_FLIGHT_HEIGHT;
      pe.container.addChild(pe.placeholder);
    }
    pe.placeholder.visible = true;
    // The ghost dim + no-hit-bounds contract holds on the placeholder path too (see {@link bind}); a
    // highlighted candidate building's placeholder takes the same green/red assign-mode tint.
    pe.placeholder.tint = entityTint(item.ref, item.ghost === true, frame.highlight);
    // Rotation applies about the graphic's own origin (the shaft centre), so the flight-height offset
    // above is not rotated with it — the arrow stays level above its ground anchor and only aims.
    if (pe.kind === 'projectile') pe.placeholder.rotation = item.rotation ?? 0;
    if (item.ghost === true) return;
    const box = placeholderBounds(pe.kind);
    const drawX = pe.motion.drawX;
    const drawY = pe.motion.drawY;
    this.stampBounds(pe, drawX + box.minX, drawY + box.minY, drawX + box.maxX, drawY + box.maxY, frameId);
  }

  /** Restamp a pooled entity's bounds in place for this frame — no allocation in the per-frame pass. */
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
