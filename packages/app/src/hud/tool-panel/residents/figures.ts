import {
  buildSpriteScene,
  type DrawItem,
  resolveLayers,
  type SpriteSheet,
  settlerPaletteLutRow,
} from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import type { FigureFrames } from '../messages/figure-frames.js';

/** The figure's map-px multiplier in its row box and how far above the box's bottom edge its feet
 *  stand (design px). */
const ROW_ZOOM = 0.72;
const ROW_FEET_INSET = 2;
/** The facing every row stands in: the body's first direction block, towards the viewer's left. */
const ROW_FACING = 0;

/** One listed row's figure canvas and the settler it shows. */
export interface ResidentFigureSlot {
  readonly entity: number;
  readonly canvas: HTMLCanvasElement;
}

/** The canvases' shared size on screen: the box in design px and the device px per design px. */
export interface ResidentFigureBox {
  readonly width: number;
  readonly height: number;
  readonly pixelScale: number;
}

/** What decides a standing figure's pixels; a change repaints the row. */
function lookKey(item: DrawItem, box: ResidentFigureBox): string {
  return [
    item.tribe,
    item.jobType,
    item.weaponGood,
    item.armorGood,
    item.young,
    item.player,
    box.width,
    box.height,
    box.pixelScale,
  ].join('|');
}

/**
 * The standing figures of the listed rows: the map's own settler, idle and unloaded, painted once into
 * the row's canvas and again only when its look changes. A list runs to hundreds of rows, so nothing
 * animates and only the rows handed in cost a scene read. Without a sprite sheet the canvases stay
 * clear.
 */
export class ResidentFigures {
  private readonly painted = new WeakMap<HTMLCanvasElement, string>();

  /** `frames` is the sheet's recoloured-frame cache, shared with every other figure painter. */
  constructor(
    private readonly sheet: SpriteSheet | undefined,
    private readonly frames: FigureFrames,
    private readonly playerColourOf?: (player: number) => number,
  ) {}

  paint(snapshot: WorldSnapshot, slots: readonly ResidentFigureSlot[], box: ResidentFigureBox): void {
    if (this.sheet === undefined || slots.length === 0) return;
    const scene = buildSpriteScene(snapshot, {
      playerColourOf: this.playerColourOf,
      keepIndoorSettlers: true,
      onlyRefs: new Set(slots.map((slot) => slot.entity)),
    });
    const items = new Map<number, DrawItem>();
    for (const item of scene) if (item.kind === 'settler') items.set(item.ref, item);
    for (const slot of slots) {
      const item = items.get(slot.entity);
      if (item === undefined) continue;
      const key = lookKey(item, box);
      if (this.painted.get(slot.canvas) === key) continue;
      this.painted.set(slot.canvas, key);
      this.draw(slot.canvas, standing(item), box);
    }
  }

  private draw(canvas: HTMLCanvasElement, item: DrawItem, box: ResidentFigureBox): void {
    const ctx = canvas.getContext('2d');
    if (ctx === null || this.sheet === undefined) return;
    const width = Math.max(1, Math.round(box.width * box.pixelScale));
    const height = Math.max(1, Math.round(box.height * box.pixelScale));
    canvas.width = width;
    canvas.height = height;
    const layers = resolveLayers(this.sheet, item, 0);
    if (layers === null) return;
    const bodyRow = settlerPaletteLutRow(this.sheet, item);
    const zoom = ROW_ZOOM * box.pixelScale;
    const feetX = width / 2;
    const feetY = height - ROW_FEET_INSET * box.pixelScale;
    this.frames.draw(ctx, layers, bodyRow, zoom, feetX, feetY);
  }
}

/** The item at rest: no atomic, no load, no fight, one facing, so every row of a look reads alike. */
function standing(item: DrawItem): DrawItem {
  const { atomicId: _atomicId, elapsed: _elapsed, carryGood: _carryGood, ...rest } = item;
  return { ...rest, state: 'idle', facing: ROW_FACING, carrying: false, engaged: false, working: false };
}
