import type { DrawItem, ResolvedLayer, SpriteSheet } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { CanvasContexts } from '../../figures/canvas-contexts.js';
import type { FigureFrameImage, FigureFrames } from '../../figures/figure-frames.js';
import { FigureScene } from '../../figures/figure-scene.js';
import { type DrawKey, sameDrawKey, writeDrawKey } from '../../figures/live-figures.js';
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

/** A frame's figures resolve together at most this often: a page emptied by the first pass has room for
 *  them all in the second. */
const RESOLVE_PASSES = 2;

interface FigurePlace {
  readonly zoom: number;
  readonly feetX: number;
  readonly feetY: number;
}

/** One figure a frame draws, between resolving its images and painting them. */
interface PendingFigure {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  item: DrawItem;
  layers: readonly ResolvedLayer[];
  place: FigurePlace;
  readonly images: (FigureFrameImage | null)[];
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
 * The settlers and vehicles drawn on their cards' thumbnails: each card's own canvas, painted from the
 * sprite sheet with the map's presentation (motion, atomics, gait) whenever its picture changes, so the
 * figure is part of the card and moves with it. Without a sprite sheet the canvases stay clear and the
 * cards still work.
 */
export class NoticeFigures {
  private readonly scene: FigureScene;
  /** Each shown vehicle's box over every frame it has drawn, so its fit holds still as it animates. */
  private readonly vehicleBounds = new Map<number, FigureBounds>();
  private readonly contexts = new CanvasContexts();
  /** The slot list last painted and its subjects, so an unchanged list costs no allocation. */
  private shownSlots: readonly NoticeFigureSlot[] = [];
  private subjects: readonly number[] = [];
  private live: ReadonlySet<number> = new Set();
  /** What each canvas shows, so a frame that would paint the same picture leaves it alone. */
  private readonly shown = new WeakMap<HTMLCanvasElement, DrawKey>();
  /** The figures of the frame being rendered, kept from frame to frame so a steady column allocates none. */
  private readonly pending: PendingFigure[] = [];
  private readonly key: DrawKey = [];

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
    if (slots !== this.shownSlots) {
      this.shownSlots = slots;
      this.subjects = slots.map((s) => s.entity);
      this.live = new Set(this.subjects);
      this.scene.keepOnly(this.live);
      for (const entity of this.vehicleBounds.keys())
        if (!this.live.has(entity)) this.vehicleBounds.delete(entity);
    }
    const items = this.scene.items(snapshot, this.subjects);
    const width = Math.max(1, Math.round(box.width * box.pixelScale));
    const height = Math.max(1, Math.round(box.height * box.pixelScale));
    const { pixelScale } = box;
    let count = 0;
    for (const slot of slots) {
      const { canvas } = slot;
      // A resize clears the canvas.
      if (canvas.width !== width || canvas.height !== height) this.shown.delete(canvas);
      const ctx = this.contexts.sized(canvas, width, height);
      if (ctx === null) continue;
      const item = this.sheet === undefined ? undefined : items.get(slot.entity);
      if (this.sheet !== undefined && item === undefined) unpictured(slot);
      const layers = item === undefined ? null : this.scene.layers(item, tick, alpha);
      const place =
        item === undefined || layers === null
          ? null
          : item.kind === 'vehicle'
            ? this.vehicleFit(slot, layers, width, height, pixelScale)
            : this.settlerPlace(slot, layers, width, height, pixelScale);
      if (item === undefined || layers === null || place === null) {
        if (this.shown.delete(canvas)) ctx.clearRect(0, 0, width, height);
        continue;
      }
      const figure = this.pending[count];
      if (figure === undefined) this.pending.push({ canvas, ctx, item, layers, place, images: [] });
      else {
        figure.canvas = canvas;
        figure.ctx = ctx;
        figure.item = item;
        figure.layers = layers;
        figure.place = place;
      }
      count++;
    }
    const settled = this.resolveAll(count);
    for (let index = 0; index < count; index++) {
      const figure = this.pending[index];
      if (figure === undefined) continue;
      const { canvas, ctx, layers, place, images } = figure;
      // Unsettled, the page may have lost this figure's images to a later one's recolour.
      if (!settled) this.frames.resolve(layers, figure.item, images);
      writeDrawKey(this.key, layers, images, place.zoom, place.feetX, place.feetY);
      let shown = this.shown.get(canvas);
      if (shown !== undefined && sameDrawKey(shown, this.key)) continue;
      ctx.clearRect(0, 0, width, height);
      this.frames.paint(ctx, layers, images, place.zoom, place.feetX, place.feetY);
      if (shown === undefined) {
        shown = [];
        this.shown.set(canvas, shown);
      }
      shown.length = 0;
      shown.push(...this.key);
    }
    // Drops the canvases of the cards that left.
    this.pending.length = count;
  }

  /**
   * Resolve the first `count` pending figures before any is drawn: in Chrome a recolour written to the page
   * after a canvas drew from it in the same frame costs about four times one written before. False when the
   * page was emptied in every pass, which takes the images resolved before it.
   */
  private resolveAll(count: number): boolean {
    for (let pass = 0; pass < RESOLVE_PASSES; pass++) {
      const generation = this.frames.generation();
      for (let index = 0; index < count; index++) {
        const figure = this.pending[index];
        if (figure !== undefined) this.frames.resolve(figure.layers, figure.item, figure.images);
      }
      if (this.frames.generation() === generation) return true;
    }
    return false;
  }

  private settlerPlace(
    slot: NoticeFigureSlot,
    layers: readonly ResolvedLayer[],
    width: number,
    height: number,
    pixelScale: number,
  ): FigurePlace {
    const zoom = THUMB_ZOOM * pixelScale;
    return {
      zoom,
      feetX: width / 2,
      feetY: feetLine(layers, height, slot.visible * pixelScale, zoom, pixelScale),
    };
  }

  private vehicleFit(
    slot: NoticeFigureSlot,
    layers: readonly ResolvedLayer[],
    width: number,
    height: number,
    pixelScale: number,
  ): FigurePlace | null {
    const bounds = growFigureBounds(this.vehicleBounds.get(slot.entity) ?? null, layers);
    if (bounds === null) return null;
    this.vehicleBounds.set(slot.entity, bounds);
    return vehicleFit(bounds, width, height, slot.visible * pixelScale, pixelScale);
  }
}
