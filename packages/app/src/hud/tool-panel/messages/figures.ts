import type { DrawItem, ResolvedLayer, SpriteSheet } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { CanvasContexts } from '../../figures/canvas-contexts.js';
import type { FigureFrames } from '../../figures/figure-frames.js';
import { FigureScene } from '../../figures/figure-scene.js';
import { type FigureBounds, growFigureBounds, vehicleFit } from '../../figures/vehicle-fit.js';

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
