import {
  buildSpriteScene,
  createPresentationTrack,
  type DrawItem,
  layerLutRow,
  type PresentationTrack,
  presentItem,
  type SpriteSheet,
  settlerPaletteLutRow,
} from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { FigureFrames } from './figure-frames.js';

/** The figure's map-px multiplier on its thumbnail, and how far above the thumbnail's bottom edge its
 *  feet stand (design px). */
const THUMB_ZOOM = 1.05;
const THUMB_FEET_INSET = 10;

/** One card's figure canvas and the settler it shows. */
export interface NoticeFigureSlot {
  readonly entity: number;
  readonly canvas: HTMLCanvasElement;
}

/** The canvases' shared size on screen: the content box in design px and the device px per design px. */
export interface NoticeFigureBox {
  readonly width: number;
  readonly height: number;
  readonly pixelScale: number;
}

/**
 * The settlers drawn on their cards' thumbnails: each card's own canvas, painted every frame from the
 * sprite sheet with the map's presentation (motion, atomics, gait), so the figure is part of the card
 * and moves with it. Without a sprite sheet the canvases stay clear and the cards still work.
 */
export class NoticeFigures {
  private readonly tracks = new Map<number, PresentationTrack>();
  private readonly contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  private readonly frames: FigureFrames;
  /** The scene built for the last (snapshot, subjects) pair; frames between ticks reuse it. */
  private sceneFor: { snapshot: WorldSnapshot; refs: string; items: ReadonlyMap<number, DrawItem> } | null =
    null;

  constructor(
    private readonly sheet: SpriteSheet | undefined,
    private readonly playerColourOf?: (player: number) => number,
  ) {
    this.frames = new FigureFrames(sheet?.palette);
  }

  /** `alpha` is the frame's inter-tick fraction, as the map draws with. */
  render(
    snapshot: WorldSnapshot,
    slots: readonly NoticeFigureSlot[],
    box: NoticeFigureBox,
    tick: number,
    alpha: number,
  ): void {
    const items = this.items(snapshot, slots);
    const width = Math.max(1, Math.round(box.width * box.pixelScale));
    const height = Math.max(1, Math.round(box.height * box.pixelScale));
    const { pixelScale } = box;
    const live = new Set<number>();
    for (const slot of slots) {
      live.add(slot.entity);
      const ctx = this.context(slot.canvas, width, height);
      if (ctx === null) continue;
      ctx.clearRect(0, 0, width, height);
      const item = items.get(slot.entity);
      if (item === undefined || this.sheet === undefined) continue;
      let track = this.tracks.get(slot.entity);
      if (track === undefined) {
        track = createPresentationTrack('settler');
        this.tracks.set(slot.entity, track);
      }
      const layers = presentItem(track, item, tick, alpha, this.sheet);
      if (layers === null) continue;
      const bodyRow = settlerPaletteLutRow(this.sheet, item);
      const feetX = width / 2;
      const feetY = height - THUMB_FEET_INSET * pixelScale;
      const zoom = THUMB_ZOOM * pixelScale;
      for (const layer of layers) {
        const row =
          this.sheet.palette === undefined ? bodyRow : layerLutRow(this.sheet.palette, layer, bodyRow);
        const image = this.frames.frame(layer, row);
        if (image === null) continue;
        const s = zoom * layer.scale;
        ctx.imageSmoothingEnabled = layer.source.scaleMode !== 'nearest';
        ctx.drawImage(
          image.image,
          image.x,
          image.y,
          image.width,
          image.height,
          feetX + (layer.dx ?? 0) * zoom + layer.frame.offsetX * s,
          feetY + (layer.dy ?? 0) * zoom + layer.frame.offsetY * s,
          image.width * s,
          image.height * s,
        );
      }
    }
    for (const entity of this.tracks.keys()) if (!live.has(entity)) this.tracks.delete(entity);
  }

  private items(snapshot: WorldSnapshot, slots: readonly NoticeFigureSlot[]): ReadonlyMap<number, DrawItem> {
    const refs = slots
      .map((s) => s.entity)
      .sort((a, b) => a - b)
      .join(',');
    if (this.sceneFor !== null && this.sceneFor.snapshot === snapshot && this.sceneFor.refs === refs) {
      return this.sceneFor.items;
    }
    const items = new Map<number, DrawItem>();
    if (this.sheet !== undefined && slots.length > 0) {
      const scene = buildSpriteScene(snapshot, {
        playerColourOf: this.playerColourOf,
        keepIndoorSettlers: true,
        onlyRefs: new Set(slots.map((s) => s.entity)),
      });
      for (const it of scene) if (it.kind === 'settler') items.set(it.ref, it);
    }
    this.sceneFor = { snapshot, refs, items };
    return items;
  }

  private context(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
    let ctx = this.contexts.get(canvas);
    if (ctx === undefined) {
      const got = canvas.getContext('2d');
      if (got === null) return null;
      ctx = got;
      this.contexts.set(canvas, ctx);
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return ctx;
  }
}
