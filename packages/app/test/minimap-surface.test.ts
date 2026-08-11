import type { SceneTerrain } from '@open-northland/render';
import { Container, type FillInstruction, Graphics, Sprite, type StrokeInstruction } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { Rect } from '../src/hud/geometry.js';
import type { MinimapFrame } from '../src/hud/minimap/frame.js';
import { FRAME_NATIVE } from '../src/hud/minimap/model.js';
import {
  createMinimapSurface,
  HOLE_UNDERLAP_NATIVE_PX,
  RASTER_OVERSAMPLE,
} from '../src/hud/minimap/surface.js';

const HOLE: Rect = { x: 0, y: 24, w: 60, h: 50 };
/** Letterboxed inside `HOLE`, the way `minimapLayout` fits a non-square map. */
const MAP: Rect = { x: 4, y: 28, w: 52, h: 42 };
const ART_SCALE = 1.5;
const TERRAIN: SceneTerrain = { width: 4, height: 4, typeIds: Array.from({ length: 16 }, () => 0) };

/** A stand-in for the baked braid; like the real one, disposing it destroys the display, which unparents
 *  it. */
function fakeFrame(): { readonly frame: MinimapFrame; disposed: () => boolean } {
  const display = new Sprite();
  let gone = false;
  return {
    frame: {
      display,
      dispose: (): void => {
        gone = true;
        display.destroy();
      },
    },
    disposed: () => gone,
  };
}

/** Drain the microtask queue, so a settled braid load has run its swap. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The surface over a hand-settled braid loader and a hand-moved renderer resolution, so a DPR change and
 * an in-flight re-bake can be interleaved on purpose.
 */
async function mountSurface(firstFrame: MinimapFrame | null) {
  const host = new Container();
  let resolution = 1;
  const requested: number[] = [];
  const pending: {
    readonly resolve: (frame: MinimapFrame | null) => void;
    readonly reject: (error: unknown) => void;
  }[] = [];
  const frameErrors: unknown[] = [];
  const created = createMinimapSurface({
    container: host,
    terrain: TERRAIN,
    hole: HOLE,
    map: MAP,
    artScale: ART_SCALE,
    resolution: () => resolution,
    loadFrame: (_artScale, res) => {
      requested.push(res);
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
    onFrameError: (error) => frameErrors.push(error),
  });
  pending.shift()?.resolve(firstFrame);
  const surface = await created;
  const container = host.children[0];
  if (!(container instanceof Container)) throw new Error('the surface parented no layer container');
  return {
    /** The container the surface was handed; it holds only the surface's own layer container. */
    host,
    container,
    surface,
    /** The resolution of every braid load the surface asked for, in order. */
    requested,
    frameErrors,
    ground: (): Sprite => {
      const child = container.children[2];
      if (!(child instanceof Sprite)) throw new Error('the surface baked no ground sprite');
      return child;
    },
    moveResolution: (next: number): void => {
      resolution = next;
      surface.syncResolution();
    },
    settleOldest: async (frame: MinimapFrame | null): Promise<void> => {
      pending.shift()?.resolve(frame);
      await flush();
    },
    settleNewest: async (frame: MinimapFrame | null): Promise<void> => {
      pending.pop()?.resolve(frame);
      await flush();
    },
    rejectOldest: async (error: unknown): Promise<void> => {
      pending.shift()?.reject(error);
      await flush();
    },
  };
}

type PaintedShape = FillInstruction | StrokeInstruction;

/** The rect the Graphics at `index` painted; Pixi may prefix the path with a `moveTo`. */
function paintedRect(container: Container, index: number, action: PaintedShape['action']): Rect {
  const drawn = container.children[index];
  if (!(drawn instanceof Graphics)) throw new Error(`child ${index} is not a Graphics`);
  const shapes = drawn.context.instructions.flatMap((i) =>
    i.action === action && 'path' in i.data ? [i as PaintedShape] : [],
  );
  const rect = shapes[0]?.data.path.instructions.find((p) => p.action === 'rect');
  if (rect === undefined) throw new Error(`child ${index} painted no ${action} rect`);
  return {
    x: Number(rect.data[0]),
    y: Number(rect.data[1]),
    w: Number(rect.data[2]),
    h: Number(rect.data[3]),
  };
}

describe('minimap surface backdrop', () => {
  it('underlaps the braid on the top and right, leaving the screen-corner edges flush', async () => {
    const { container } = await mountSurface(fakeFrame().frame);
    const underlap = HOLE_UNDERLAP_NATIVE_PX * ART_SCALE;

    const painted = paintedRect(container, 0, 'fill');
    expect(painted.x).toBe(HOLE.x);
    expect(painted.y + painted.h).toBe(HOLE.y + HOLE.h);
    expect(painted.y).toBe(HOLE.y - underlap);
    expect(painted.w).toBe(HOLE.w + underlap);
  });

  it('keeps the underlap under the braid top strip that hides it', () => {
    expect(HOLE_UNDERLAP_NATIVE_PX).toBeLessThan(FRAME_NATIVE.inner.y);
  });

  it('fills the bare hole when there is no braid to hide an underlap', async () => {
    const { container } = await mountSurface(null);

    expect(paintedRect(container, 0, 'fill')).toEqual(HOLE);
  });
});

describe('minimap surface braid', () => {
  it('draws over the backdrop and under the ground raster', async () => {
    const art = fakeFrame();
    const { container } = await mountSurface(art.frame);

    expect(container.getChildIndex(art.frame.display)).toBe(1);
    expect(container.children).toHaveLength(3);
  });

  it('outlines the hole with the flat fallback frame on a bare checkout', async () => {
    const { container } = await mountSurface(null);

    expect(paintedRect(container, 1, 'stroke')).toEqual({
      x: HOLE.x - 1,
      y: HOLE.y - 1,
      w: HOLE.w + 2,
      h: HOLE.h + 2,
    });
  });

  it('re-bakes at the new resolution and swaps in at its own depth', async () => {
    const art = fakeFrame();
    const next = fakeFrame();
    const h = await mountSurface(art.frame);

    h.moveResolution(2);
    await h.settleOldest(next.frame);

    expect(h.requested).toEqual([1, 2]);
    expect(art.disposed()).toBe(true);
    expect(h.container.getChildIndex(next.frame.display)).toBe(1);
    expect(h.container.children).toHaveLength(3);
  });

  it('is never retried on a bare checkout, however the DPR moves', async () => {
    const h = await mountSurface(null);

    h.moveResolution(2);
    await flush();

    expect(h.requested).toEqual([1]);
  });

  it('drops a superseded re-bake instead of swapping it in over the newer one', async () => {
    const art = fakeFrame();
    const stale = fakeFrame();
    const newest = fakeFrame();
    const h = await mountSurface(art.frame);

    h.moveResolution(2);
    h.moveResolution(3);
    await h.settleNewest(newest.frame);
    await h.settleOldest(stale.frame);

    expect(h.requested).toEqual([1, 2, 3]);
    expect(stale.disposed()).toBe(true);
    expect(h.container.getChildIndex(newest.frame.display)).toBe(1);
    expect(h.container.children).toHaveLength(3);
  });

  it('disposes a re-bake that arrives after the surface was torn down', async () => {
    const art = fakeFrame();
    const late = fakeFrame();
    const h = await mountSurface(art.frame);

    h.moveResolution(2);
    h.surface.dispose();
    await h.settleOldest(late.frame);

    expect(art.disposed()).toBe(true);
    expect(late.disposed()).toBe(true);
    // The surface took its own layers down with it, and parented nothing after the teardown.
    expect(h.host.children).toHaveLength(0);
  });

  it('keeps the current braid when a DPR re-bake fails', async () => {
    const art = fakeFrame();
    const h = await mountSurface(art.frame);
    const failure = new Error('context lost');

    h.moveResolution(2);
    await h.rejectOldest(failure);

    expect(h.frameErrors).toEqual([failure]);
    expect(art.disposed()).toBe(false);
    expect(h.container.getChildIndex(art.frame.display)).toBe(1);
  });
});

describe('minimap surface ground raster', () => {
  it('bakes the map picture oversampled against the device pixel ratio', async () => {
    const { ground } = await mountSurface(null);

    expect(ground().texture.source.width).toBe(MAP.w * RASTER_OVERSAMPLE);
    expect(ground().texture.source.height).toBe(MAP.h * RASTER_OVERSAMPLE);
    expect([ground().x, ground().y]).toEqual([MAP.x, MAP.y]);
  });

  it('holds one bake while the DPR stands still', async () => {
    const h = await mountSurface(null);
    const baked = h.ground().texture;

    h.moveResolution(1);

    expect(h.ground().texture).toBe(baked);
    expect(baked.destroyed).toBe(false);
  });

  it('re-bakes denser on a DPR change and destroys the bake it replaced', async () => {
    const h = await mountSurface(null);
    const baked = h.ground().texture;

    h.moveResolution(2);

    expect(h.ground().texture).not.toBe(baked);
    expect(h.ground().texture.source.width).toBe(MAP.w * RASTER_OVERSAMPLE * 2);
    expect(baked.destroyed).toBe(true);
  });

  // Pixi re-applies an explicitly set width and height when the texture is swapped. The re-bake relies
  // on that instead of re-pinning the size itself, so pin the dependency.
  it('keeps its on-screen size when the denser bake replaces the texture', async () => {
    const h = await mountSurface(null);
    expect([h.ground().width, h.ground().height]).toEqual([MAP.w, MAP.h]);

    h.moveResolution(2);

    expect([h.ground().width, h.ground().height]).toEqual([MAP.w, MAP.h]);
  });

  it('destroys the ground bake and the braid on dispose', async () => {
    const art = fakeFrame();
    const h = await mountSurface(art.frame);
    const baked = h.ground().texture;

    h.surface.dispose();

    expect(baked.destroyed).toBe(true);
    expect(art.disposed()).toBe(true);
  });
});
