import type { DrawItem, ResolvedLayer, SpriteSheet } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { CanvasContexts } from '../../figures/canvas-contexts.js';
import type { FigureFrames } from '../../figures/figure-frames.js';
import { FigureScene } from '../../figures/figure-scene.js';

/** The figure's map-px multiplier on its thumbnail, and how far above the thumbnail's bottom edge its
 *  feet stand (design px): the usual place, and the closest a covered card's lowered figure comes. */
const THUMB_ZOOM = 1.05;
const THUMB_FEET_INSET = 6;
const THUMB_FEET_INSET_MIN = 2;

/** Where the feet go (canvas px): the usual inset, or lower on a covered card so the figure's middle
 *  meets the middle of the visible strip, stopping at the minimum inset from the bottom edge. */
export function feetLine(
  layers: readonly ResolvedLayer[],
  height: number,
  visible: number,
  zoom: number,
  pixelScale: number,
): number {
  const usual = height - THUMB_FEET_INSET * pixelScale;
  let top = 0;
  for (const layer of layers) {
    top = Math.min(top, (layer.dy ?? 0) * zoom + layer.frame.offsetY * zoom * layer.scale);
  }
  const centred = height - visible / 2 - top / 2;
  return Math.min(Math.max(usual, centred), height - THUMB_FEET_INSET_MIN * pixelScale);
}

/** The room a vehicle keeps inside its thumbnail (design px), as a building's body does: the sides, the
 *  bottom and the top, and on a covered card a top that follows the cover, clearing its edge by a few px
 *  up to a cap. */
const VEHICLE_PAD_SIDE = 5;
const VEHICLE_PAD_BOTTOM = 3;
const VEHICLE_PAD_TOP = 5;
const VEHICLE_COVER_CLEARANCE = 2;
const VEHICLE_PAD_TOP_MAX = 24;
/** Canvas px per map px per design px a vehicle may take at most, so a handcart is not blown up. */
const VEHICLE_MAX_ZOOM = 1;

/** A drawn body's box around its feet anchor (map px). */
export interface FigureBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Grow `into` by the frames of `layers` that count towards the body, shadows and swaying overlays left
 *  out; the heave of a ship at sea is left out too, so the box holds still while the hull rides it. */
export function growFigureBounds(
  into: FigureBounds | null,
  layers: readonly ResolvedLayer[],
): FigureBounds | null {
  let out = into;
  for (const layer of layers) {
    if (layer.boundsExempt === true) continue;
    const x = layer.frame.offsetX * layer.scale;
    const y = layer.frame.offsetY * layer.scale;
    const right = x + layer.frame.width * layer.scale;
    const bottom = y + layer.frame.height * layer.scale;
    if (out === null) out = { minX: x, minY: y, maxX: right, maxY: bottom };
    else {
      out.minX = Math.min(out.minX, x);
      out.minY = Math.min(out.minY, y);
      out.maxX = Math.max(out.maxX, right);
      out.maxY = Math.max(out.maxY, bottom);
    }
  }
  return out;
}

/** Where a vehicle's feet go on its canvas (canvas px) and its zoom (canvas px per map px). */
export interface FigureFit {
  readonly zoom: number;
  readonly feetX: number;
  readonly feetY: number;
}

/** Contain `bounds` in the canvas inside the thumbnail's padding, centred, never past the zoom cap. On a
 *  covered card (`visible` canvas px left of `height`) the top padding follows the cover, so the vehicle
 *  shrinks into the visible strip as a building's body does. */
export function vehicleFit(
  bounds: FigureBounds,
  width: number,
  height: number,
  visible: number,
  pixelScale: number,
): FigureFit {
  const covered = Math.max(0, height - visible);
  const top = Math.min(
    Math.max(VEHICLE_PAD_TOP * pixelScale, covered - VEHICLE_COVER_CLEARANCE * pixelScale),
    VEHICLE_PAD_TOP_MAX * pixelScale,
  );
  const left = VEHICLE_PAD_SIDE * pixelScale;
  const right = width - VEHICLE_PAD_SIDE * pixelScale;
  const bottom = height - VEHICLE_PAD_BOTTOM * pixelScale;
  const boundsW = Math.max(1, bounds.maxX - bounds.minX);
  const boundsH = Math.max(1, bounds.maxY - bounds.minY);
  const zoom = Math.min((right - left) / boundsW, (bottom - top) / boundsH, VEHICLE_MAX_ZOOM * pixelScale);
  return {
    zoom,
    feetX: (left + right) / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom,
    feetY: (top + bottom) / 2 - ((bounds.minY + bounds.maxY) / 2) * zoom,
  };
}

/** One card's figure canvas, the settler or vehicle it shows and how much of the card's height the fan leaves
 *  uncovered (design px, the card's whole height when the cards fit). */
export interface NoticeFigureSlot {
  readonly entity: number;
  readonly canvas: HTMLCanvasElement;
  readonly visible: number;
}

/** The canvases' shared size on screen: the content box in design px and the device px per design px. */
export interface NoticeFigureBox {
  readonly width: number;
  readonly height: number;
  readonly pixelScale: number;
}

/**
 * The settlers and vehicles drawn on their cards' thumbnails: each card's own canvas, painted every frame
 * from the sprite sheet with the map's presentation (motion, atomics, gait), so the figure is part of the
 * card and moves with it. Without a sprite sheet the canvases stay clear and the cards still work.
 */
export class NoticeFigures {
  private readonly scene: FigureScene;
  /** Each shown vehicle's box over every frame it has drawn, so its fit holds still as it animates. */
  private readonly vehicleBounds = new Map<number, FigureBounds>();
  private readonly contexts = new CanvasContexts();

  /** `frames` is the sheet's recoloured-frame cache, shared with every other figure painter. */
  constructor(
    private readonly sheet: SpriteSheet | undefined,
    private readonly frames: FigureFrames,
    playerColourOf?: (player: number) => number,
  ) {
    this.scene = new FigureScene(sheet, playerColourOf);
  }

  /** `alpha` is the frame's inter-tick fraction, as the map draws with. `unpictured` takes a slot whose
   *  subject the scene no longer draws (a vehicle driven aboard a ship), so its card can show a glyph
   *  in place of an empty canvas. */
  render(
    snapshot: WorldSnapshot,
    slots: readonly NoticeFigureSlot[],
    box: NoticeFigureBox,
    tick: number,
    alpha: number,
    unpictured: (slot: NoticeFigureSlot) => void,
  ): void {
    const items = this.scene.items(
      snapshot,
      slots.map((s) => s.entity),
    );
    const width = Math.max(1, Math.round(box.width * box.pixelScale));
    const height = Math.max(1, Math.round(box.height * box.pixelScale));
    const { pixelScale } = box;
    const live = new Set<number>();
    for (const slot of slots) {
      live.add(slot.entity);
      const ctx = this.contexts.sized(slot.canvas, width, height);
      if (ctx === null) continue;
      ctx.clearRect(0, 0, width, height);
      if (this.sheet === undefined) continue;
      const item = items.get(slot.entity);
      if (item === undefined) {
        unpictured(slot);
        continue;
      }
      const layers = this.scene.layers(item, tick, alpha);
      if (layers === null) continue;
      if (item.kind === 'vehicle') {
        this.drawVehicle(ctx, slot, item, layers, width, height, pixelScale);
        continue;
      }
      const zoom = THUMB_ZOOM * pixelScale;
      const feetX = width / 2;
      const feetY = feetLine(layers, height, slot.visible * pixelScale, zoom, pixelScale);
      this.frames.draw(ctx, layers, item, zoom, feetX, feetY);
    }
    this.scene.keepOnly(live);
    for (const entity of this.vehicleBounds.keys()) if (!live.has(entity)) this.vehicleBounds.delete(entity);
  }

  private drawVehicle(
    ctx: CanvasRenderingContext2D,
    slot: NoticeFigureSlot,
    item: DrawItem,
    layers: readonly ResolvedLayer[],
    width: number,
    height: number,
    pixelScale: number,
  ): void {
    const bounds = growFigureBounds(this.vehicleBounds.get(slot.entity) ?? null, layers);
    if (bounds === null) return;
    this.vehicleBounds.set(slot.entity, bounds);
    const fit = vehicleFit(bounds, width, height, slot.visible * pixelScale, pixelScale);
    this.frames.draw(ctx, layers, item, fit.zoom, fit.feetX, fit.feetY);
  }
}
