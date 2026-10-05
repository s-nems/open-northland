import type { DrawItem, ResolvedLayer } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FigureFrameImage, FigureFrames } from '../src/hud/figures/figure-frames.js';
import { FigureScene } from '../src/hud/figures/figure-scene.js';
import { type FigureSlot, LiveFigures } from '../src/hud/figures/live-figures.js';

const BOX = { width: 10, height: 12, pixelScale: 1 };
const snapshot = {} as WorldSnapshot;

/** Each entity's current animation image; a test changes it to make a new picture. */
const pictures = new Map<number, FigureFrameImage>();
const image = (): FigureFrameImage =>
  ({ image: {} as CanvasImageSource, x: 0, y: 0, width: 1, height: 1 }) as FigureFrameImage;

function slotFor(entity: number) {
  const ctx = { clearRect: vi.fn() };
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const slot: FigureSlot = { entity, canvas, box: BOX, zoom: 1, feetInset: 0 };
  return { slot, ctx };
}

/** A painter over a stub scene, every entity a settler with one layer, and stub frames whose recolours
 *  `refuse` turns away as a passed deadline would. */
function painter() {
  vi.spyOn(FigureScene.prototype, 'items').mockImplementation(
    (_snap, subjects) => new Map(subjects.map((ref) => [ref, { kind: 'settler', ref } as DrawItem])),
  );
  vi.spyOn(FigureScene.prototype, 'layers').mockImplementation((item) => [
    { scale: 1, frame: { ref: item.ref } } as unknown as ResolvedLayer,
  ]);
  const refuse = new Set<number>();
  const resolved: number[] = [];
  const frames = {
    resolve: vi.fn((_layers: readonly ResolvedLayer[], item: DrawItem, out: (FigureFrameImage | null)[]) => {
      resolved.push(item.ref);
      if (refuse.has(item.ref)) return false;
      out.length = 0;
      out.push(pictures.get(item.ref) ?? null);
      return true;
    }),
    paint: vi.fn(),
  };
  const figures = new LiveFigures(undefined, frames as unknown as FigureFrames);
  return { figures, frames, refuse, resolved };
}

afterEach(() => {
  vi.restoreAllMocks();
  pictures.clear();
});

describe('live figures', () => {
  it('draws a picture once and leaves the canvas alone while it holds', () => {
    const { figures, frames } = painter();
    const { slot } = slotFor(1);
    pictures.set(1, image());
    const slots = [slot];

    expect([...figures.paint(snapshot, slots, 0, 0)]).toEqual([1]);
    expect([...figures.paint(snapshot, slots, 0, 0)]).toEqual([1]);
    expect(frames.paint).toHaveBeenCalledTimes(1);

    pictures.set(1, image());
    figures.paint(snapshot, slots, 0, 0);
    expect(frames.paint).toHaveBeenCalledTimes(2);
  });

  it('keeps the last picture when the new one has to wait, and leaves a first one empty', () => {
    const { figures, frames, refuse } = painter();
    const drawnBefore = slotFor(1);
    const fresh = slotFor(2);
    pictures.set(1, image());
    figures.paint(snapshot, [drawnBefore.slot], 0, 0);
    drawnBefore.ctx.clearRect.mockClear();

    refuse.add(1).add(2);
    pictures.set(1, image());
    expect([...figures.paint(snapshot, [drawnBefore.slot, fresh.slot], 0, 0)]).toEqual([1]);
    expect(frames.paint).toHaveBeenCalledTimes(1);
    expect(drawnBefore.ctx.clearRect).not.toHaveBeenCalled();
  });

  it('redraws a canvas resized under it, and clears one that shows another person now', () => {
    const { figures, frames } = painter();
    const { slot, ctx } = slotFor(1);
    pictures.set(1, image());
    pictures.set(2, image());
    figures.paint(snapshot, [slot], 0, 0);

    slot.canvas.width = 0;
    figures.paint(snapshot, [slot], 0, 0);
    expect(frames.paint).toHaveBeenCalledTimes(2);

    const reused: FigureSlot = { ...slot, entity: 2 };
    ctx.clearRect.mockClear();
    figures.paint(snapshot, [reused], 0, 0);
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(frames.paint).toHaveBeenCalledTimes(3);
  });

  it('starts the next paint at the slot the deadline cut', () => {
    const { figures, refuse, resolved } = painter();
    const slots = [1, 2, 3].map((entity) => {
      pictures.set(entity, image());
      return slotFor(entity).slot;
    });
    refuse.add(2);
    figures.paint(snapshot, slots, 0, 0);
    refuse.clear();
    resolved.length = 0;
    figures.paint(snapshot, slots, 0, 0);
    expect(resolved).toEqual([2, 3, 1]);
  });
});
