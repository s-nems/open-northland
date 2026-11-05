import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AtlasSheetRef } from '../../../../src/content/atlas-sheet/index.js';
import { ColouredPages, filmStep, layoutFilm } from '../../../../src/hud/dom/knowledge/motion.js';

const decode = vi.hoisted(() => vi.fn());
vi.mock('../../../../src/content/atlas-sheet/index.js', () => ({
  palettedSheetBitmap: decode,
  pictureSheetUrl: () => null,
}));

const STEP_MS = 100;

const frame = (x: number, offsetX: number, offsetY: number, width = 4, height = 8) => ({
  bobId: 0,
  rect: { x, y: 0, width, height },
  offsetX,
  offsetY,
});

describe('filmStep', () => {
  it('holds a step for its time and loops', () => {
    expect(filmStep(99, STEP_MS, 3)).toBe(0);
    expect(filmStep(100, STEP_MS, 3)).toBe(1);
    expect(filmStep(300, STEP_MS, 3)).toBe(0);
  });
});

describe('layoutFilm', () => {
  it('keeps the figure on one origin across the clip', () => {
    const layout = layoutFilm([[frame(0, -2, -10), frame(10, 2, -8)]]);
    expect([layout.width, layout.height]).toEqual([8, 10]);
    expect(layout.steps.map((parts) => [parts[0]?.x, parts[0]?.y])).toEqual([
      [0, 0],
      [4, 2],
    ]);
  });

  it('puts the head over the body and drops a step with no body', () => {
    const body = [frame(0, 0, 0), frame(0, 0, 0, 0, 0)];
    const head = [frame(20, 1, -3), frame(20, 1, -3)];
    const layout = layoutFilm([body, head]);
    expect(layout.steps).toHaveLength(1);
    expect(layout.steps[0]?.map((part) => part.page)).toEqual([0, 1]);
  });

  it('lays out nothing for a sheet that draws none of the bobs', () => {
    expect(layoutFilm([[undefined]]).steps).toEqual([]);
  });
});

describe('ColouredPages', () => {
  const IDLE_MS = 20_000;
  const sheet = { image: 'sheet.png', palette: 'skin' } as unknown as AtlasSheetRef;
  let close: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    close = vi.fn();
    decode.mockReset();
    decode.mockImplementation(() => Promise.resolve({ close } as unknown as ImageBitmap));
  });
  afterEach(() => vi.useRealTimers());

  it('decodes a page once for every film drawing it, and closes it only after the last one idles', async () => {
    const pages = new ColouredPages();
    const first = pages.acquire(sheet);
    pages.acquire(sheet);
    expect(decode).toHaveBeenCalledOnce();
    pages.release(first.key);
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(close).not.toHaveBeenCalled();
    pages.release(first.key);
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(close).toHaveBeenCalledOnce();
    pages.acquire(sheet);
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it('keeps a page a film takes again before it idles out', async () => {
    const pages = new ColouredPages();
    pages.release(pages.acquire(sheet).key);
    await vi.advanceTimersByTimeAsync(IDLE_MS / 2);
    pages.acquire(sheet);
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(close).not.toHaveBeenCalled();
    expect(decode).toHaveBeenCalledOnce();
  });

  it('forgets a page that failed to load, so the next film tries again', async () => {
    decode.mockImplementationOnce(() => Promise.reject(new Error('gone')));
    const pages = new ColouredPages();
    await expect(pages.acquire(sheet).bitmap).rejects.toThrow('gone');
    pages.acquire(sheet);
    expect(decode).toHaveBeenCalledTimes(2);
  });
});
