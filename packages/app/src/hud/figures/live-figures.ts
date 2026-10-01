import type { SpriteSheet } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { CanvasContexts } from './canvas-contexts.js';
import type { FigureFrames } from './figure-frames.js';
import { FigureScene } from './figure-scene.js';
import { type FigureBounds, growFigureBounds, vehicleFit } from './vehicle-fit.js';

/** A canvas's size on screen: the box in design px and the device px per design px. */
export interface FigureBox {
  readonly width: number;
  readonly height: number;
  readonly pixelScale: number;
}

/** One small canvas showing one settler or vehicle: its box, the map px per design px a settler is drawn
 *  at, and how far above the box's bottom edge its feet stand (design px). A vehicle fits itself to the
 *  box instead. */
export interface FigureSlot {
  readonly entity: number;
  readonly canvas: HTMLCanvasElement;
  readonly box: FigureBox;
  readonly zoom: number;
  readonly feetInset: number;
}

/** No slot: painting it drops every presentation track, so a panel shown again starts afresh. */
export const NO_FIGURE_SLOTS: readonly FigureSlot[] = [];

/**
 * Settlers and vehicles drawn into small canvases every frame with the map's own presentation, so a list
 * row or a panel well shows what the unit is doing right now. The caller hands in only the slots on
 * screen. Without a sprite sheet the canvases stay clear.
 */
export class LiveFigures {
  private readonly scene: FigureScene;
  private readonly contexts = new CanvasContexts();
  private readonly drawn = new Set<number>();
  /** Each shown vehicle's box over every frame it has drawn, so its fit holds still as it animates. */
  private readonly vehicleBounds = new Map<number, FigureBounds>();
  /** The slot list last painted and its settlers, so an unchanged list costs no allocation. */
  private shownSlots: readonly FigureSlot[] = [];
  private subjects: readonly number[] = [];

  /** `frames` is the sheet's recoloured-frame cache, shared with every other figure painter. */
  constructor(
    sheet: SpriteSheet | undefined,
    private readonly frames: FigureFrames,
    playerColourOf?: (player: number) => number,
  ) {
    this.scene = new FigureScene(sheet, playerColourOf);
  }

  /** Paint `slots` for this frame; `alpha` is its inter-tick fraction. Answers the units drawn: a slot
   *  whose unit the scene does not draw (a rider aboard a ship) is left clear. The answer is
   *  this painter's own set, valid until the next call. */
  paint(
    snapshot: WorldSnapshot,
    slots: readonly FigureSlot[],
    tick: number,
    alpha: number,
  ): ReadonlySet<number> {
    if (slots !== this.shownSlots) {
      this.shownSlots = slots;
      this.subjects = slots.map((slot) => slot.entity);
      const live = new Set(this.subjects);
      this.scene.keepOnly(live);
      for (const entity of this.vehicleBounds.keys())
        if (!live.has(entity)) this.vehicleBounds.delete(entity);
    }
    const items = this.scene.items(snapshot, this.subjects);
    this.drawn.clear();
    for (const slot of slots) {
      const { box } = slot;
      const width = Math.max(1, Math.round(box.width * box.pixelScale));
      const height = Math.max(1, Math.round(box.height * box.pixelScale));
      const ctx = this.contexts.sized(slot.canvas, width, height);
      if (ctx === null) continue;
      ctx.clearRect(0, 0, width, height);
      const item = items.get(slot.entity);
      if (item?.kind !== 'settler' && item?.kind !== 'vehicle') continue;
      const layers = this.scene.layers(item, tick, alpha);
      if (layers === null) continue;
      if (item.kind === 'vehicle') {
        const bounds = growFigureBounds(this.vehicleBounds.get(slot.entity) ?? null, layers);
        if (bounds === null) continue;
        this.vehicleBounds.set(slot.entity, bounds);
        const fit = vehicleFit(bounds, width, height, height, box.pixelScale);
        this.frames.draw(ctx, layers, item, fit.zoom, fit.feetX, fit.feetY);
        this.drawn.add(slot.entity);
        continue;
      }
      this.drawn.add(slot.entity);
      const zoom = slot.zoom * box.pixelScale;
      this.frames.draw(ctx, layers, item, zoom, width / 2, height - slot.feetInset * box.pixelScale);
    }
    return this.drawn;
  }
}
