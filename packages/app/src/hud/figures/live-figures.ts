import type { DrawItem, ResolvedLayer, SpriteSheet } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { CanvasContexts } from './canvas-contexts.js';
import type { FigureFrameImage, FigureFrames } from './figure-frames.js';
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

/** Ms one paint of a painter's slots may spend recolouring. With every settler on its own palette each
 *  animation step of each figure is a recolour (0.02 ms, 0.1 ms with its atlas read; a 95-soldier roster
 *  probe), so a large roster animates its figures at a lower rate instead of costing the frame more. */
const RECOLOUR_MS_PER_PAINT = 0.3;
/** Ms one paint may spend on figures shown for the first time, so a panel opening on a few people fills
 *  at once and a big selection fills over a few frames. */
const FIRST_PICTURE_MS_PER_PAINT = 4;

/** A drawn picture's placement, then per layer its image, scale, offset and opacity. */
type DrawKey = (FigureFrameImage | number | null)[];

interface ShownFigure {
  readonly entity: number;
  readonly key: DrawKey;
}

function sameKey(a: DrawKey, b: DrawKey): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** No slot: painting it drops every presentation track, so a panel shown again starts afresh. */
export const NO_FIGURE_SLOTS: readonly FigureSlot[] = [];

/**
 * Settlers and vehicles drawn into small canvases with the map's own presentation, so a list row or a
 * panel well shows what the unit is doing right now; a canvas is redrawn when its picture changes. The
 * caller hands in only the slots on screen. Without a sprite sheet the canvases stay clear.
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
  /** What each canvas shows, so a frame that would draw the same picture leaves it alone. */
  private readonly shown = new WeakMap<HTMLCanvasElement, ShownFigure>();
  /** When this paint stops recolouring for a well that shows a picture already, and for one that does not. */
  private redrawDeadline = 0;
  private firstDeadline = 0;
  /** The slot the last paint's deadline cut, where the next paint starts. */
  private resumeAt = 0;
  private readonly images: (FigureFrameImage | null)[] = [];
  private readonly key: DrawKey = [];

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
    const start = performance.now();
    this.redrawDeadline = start + RECOLOUR_MS_PER_PAINT;
    this.firstDeadline = start + FIRST_PICTURE_MS_PER_PAINT;
    let resume: number | null = null;
    // Round the list from where the deadline last cut it, so a long roster's tail is not starved.
    for (let n = 0; n < slots.length; n++) {
      const index = (this.resumeAt + n) % slots.length;
      const slot = slots[index];
      if (slot === undefined) continue;
      const outcome = this.paintSlot(slot, items.get(slot.entity), tick, alpha);
      if ((outcome === 'deferred' || outcome === 'waiting') && resume === null) resume = index;
      if (outcome === 'drawn' || outcome === 'deferred') this.drawn.add(slot.entity);
    }
    this.resumeAt = resume ?? 0;
    return this.drawn;
  }

  /** Draw one slot unless it already shows this picture. A slot whose next picture needs a recolour past
   *  the paint's deadline keeps its last one ('deferred'), or stays empty until a later paint ('waiting');
   *  'clear' leaves it empty. */
  private paintSlot(
    slot: FigureSlot,
    item: DrawItem | undefined,
    tick: number,
    alpha: number,
  ): 'drawn' | 'deferred' | 'waiting' | 'clear' {
    const { box, canvas } = slot;
    const width = Math.max(1, Math.round(box.width * box.pixelScale));
    const height = Math.max(1, Math.round(box.height * box.pixelScale));
    let shown = this.shown.get(canvas);
    const otherPerson = shown !== undefined && shown.entity !== slot.entity;
    // A resize clears the canvas; another person's picture is cleared here.
    if (shown !== undefined && (otherPerson || canvas.width !== width || canvas.height !== height)) {
      this.shown.delete(canvas);
      shown = undefined;
    }
    const ctx = this.contexts.sized(canvas, width, height);
    if (ctx === null) return 'clear';
    if (otherPerson) ctx.clearRect(0, 0, width, height);
    const layers =
      item?.kind === 'settler' || item?.kind === 'vehicle' ? this.scene.layers(item, tick, alpha) : null;
    const place =
      item === undefined || layers === null ? null : this.placement(slot, item, layers, width, height);
    if (item === undefined || layers === null || place === null) {
      if (shown !== undefined) ctx.clearRect(0, 0, width, height);
      this.shown.delete(canvas);
      return 'clear';
    }
    const deadline = shown === undefined ? this.firstDeadline : this.redrawDeadline;
    if (!this.frames.resolve(layers, item, this.images, deadline)) {
      return shown === undefined ? 'waiting' : 'deferred';
    }
    const key = this.key;
    key.length = 0;
    key.push(place.zoom, place.feetX, place.feetY);
    for (let index = 0; index < layers.length; index++) {
      const layer = layers[index];
      if (layer === undefined) continue;
      key.push(this.images[index] ?? null, layer.scale, layer.dx ?? 0, layer.dy ?? 0, layer.glow ?? 1);
    }
    if (shown !== undefined && sameKey(shown.key, key)) return 'drawn';
    ctx.clearRect(0, 0, width, height);
    this.frames.paint(ctx, layers, this.images, place.zoom, place.feetX, place.feetY);
    if (shown === undefined) {
      shown = { entity: slot.entity, key: [] };
      this.shown.set(canvas, shown);
    }
    shown.key.length = 0;
    shown.key.push(...key);
    return 'drawn';
  }

  /** Where the figure stands in its canvas: a settler at the slot's zoom over its feet line, a vehicle
   *  fitted to the box over every frame it has drawn. */
  private placement(
    slot: FigureSlot,
    item: DrawItem,
    layers: readonly ResolvedLayer[],
    width: number,
    height: number,
  ): { readonly zoom: number; readonly feetX: number; readonly feetY: number } | null {
    const { box } = slot;
    if (item.kind === 'vehicle') {
      const bounds = growFigureBounds(this.vehicleBounds.get(slot.entity) ?? null, layers);
      if (bounds === null) return null;
      this.vehicleBounds.set(slot.entity, bounds);
      return vehicleFit(bounds, width, height, height, box.pixelScale);
    }
    return {
      zoom: slot.zoom * box.pixelScale,
      feetX: width / 2,
      feetY: height - slot.feetInset * box.pixelScale,
    };
  }
}
