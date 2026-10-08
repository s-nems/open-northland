import { describe, expect, it } from 'vitest';
import {
  createDragJumpFilter,
  type DragStep,
  JUMP_FLOOR_PX,
  JUMP_RATIO,
  normalisedStepPx,
  REFERENCE_FRAME_MS,
} from '../src/view/camera/drag-jump-filter.js';

/** Which drag steps the jump filter applies, holds back, and drops as a browser-reported cursor warp. */

const FRAME = REFERENCE_FRAME_MS;
const NORMAL_PX = 40;
const step = (dx: number, dy = 0, dtMs: number | undefined = FRAME): DragStep => ({ dx, dy, dtMs });

const drag = () => {
  const filter = createDragJumpFilter();
  const applied: { dx: number; dy: number }[] = [];
  const dropped: string[] = [];
  const feed = (...steps: DragStep[]): void => {
    for (const s of steps) {
      const result = filter.step(s);
      applied.push({ dx: result.dx, dy: result.dy });
      if (result.dropped) dropped.push(result.dropped.reason);
    }
  };
  const total = (): number => applied.reduce((sum, a) => sum + a.dx, 0);
  return { filter, applied, dropped, feed, total };
};

describe('normalisedStepPx', () => {
  it('spreads a step over the frames it took and never inflates a near-instant one past a short frame', () => {
    expect(normalisedStepPx(step(300, 0, FRAME))).toBeCloseTo(300);
    expect(normalisedStepPx(step(300, 0, FRAME * 6))).toBeCloseTo(50);
    expect(normalisedStepPx(step(30, 0, 0))).toBeCloseTo((30 * FRAME) / 4);
    expect(normalisedStepPx(step(30, 40, undefined))).toBe(50);
  });
});

describe('createDragJumpFilter', () => {
  it('passes ordinary and gradually quickening steps straight through', () => {
    const { feed, dropped, total } = drag();
    feed(step(10), step(NORMAL_PX), step(NORMAL_PX * 2), step(NORMAL_PX * 2.5), step(-NORMAL_PX * 2));
    expect(dropped).toEqual([]);
    expect(total()).toBe(10 + NORMAL_PX + NORMAL_PX * 2 + NORMAL_PX * 2.5 - NORMAL_PX * 2);
  });

  it('drops one jump between normal steps, which still apply', () => {
    const { feed, applied, dropped } = drag();
    feed(step(NORMAL_PX), step(JUMP_FLOOR_PX * 3), step(NORMAL_PX));
    expect(applied).toEqual([
      { dx: NORMAL_PX, dy: 0 },
      { dx: 0, dy: 0 },
      { dx: NORMAL_PX, dy: 0 },
    ]);
    expect(dropped).toEqual(['isolated']);
  });

  it('drops a jump and the jump back as one warp', () => {
    const { feed, dropped, total } = drag();
    const warp = JUMP_FLOOR_PX * 2;
    feed(step(NORMAL_PX), step(0, -warp), step(0, warp), step(NORMAL_PX));
    expect(dropped).toEqual(['reversal']);
    expect(total()).toBe(NORMAL_PX * 2);
  });

  it('applies a fast throw from rest once a second step confirms it, together with the first', () => {
    const { feed, applied, dropped } = drag();
    const throwPx = JUMP_FLOOR_PX * 2;
    feed(step(throwPx), step(throwPx), step(throwPx), step(NORMAL_PX));
    expect(applied).toEqual([
      { dx: 0, dy: 0 },
      { dx: throwPx * 2, dy: 0 },
      { dx: throwPx, dy: 0 },
      { dx: NORMAL_PX, dy: 0 },
    ]);
    expect(dropped).toEqual([]);
  });

  it('confirms a throw by a smaller step the same way, and drops one followed by a crawl', () => {
    const confirmed = drag();
    const throwPx = JUMP_FLOOR_PX * 2;
    confirmed.feed(step(throwPx), step(throwPx / JUMP_RATIO));
    expect(confirmed.dropped).toEqual([]);
    expect(confirmed.total()).toBe(throwPx + throwPx / JUMP_RATIO);

    const crawl = drag();
    crawl.feed(step(throwPx), step(NORMAL_PX));
    expect(crawl.dropped).toEqual(['isolated']);
    expect(crawl.total()).toBe(NORMAL_PX);
  });

  it('replaces a held jump by a bigger-ratio outlier the same way, dropping the first', () => {
    const { feed, applied, dropped } = drag();
    feed(step(JUMP_FLOOR_PX * 20), step(JUMP_FLOOR_PX * 2), step(JUMP_FLOOR_PX * 2));
    expect(dropped).toEqual(['isolated']);
    expect(applied.at(-1)).toEqual({ dx: JUMP_FLOOR_PX * 4, dy: 0 });
  });

  it('treats a long frame as spread motion, not a jump', () => {
    const { feed, dropped, total } = drag();
    const hitchFrames = 8;
    feed(step(NORMAL_PX), step(NORMAL_PX * hitchFrames, 0, FRAME * hitchFrames), step(NORMAL_PX));
    expect(dropped).toEqual([]);
    expect(total()).toBe(NORMAL_PX * (hitchFrames + 2));
  });

  it('raises the bar with the recent pace so a quick drag keeps its own big steps', () => {
    const { feed, dropped, total } = drag();
    const pace = JUMP_FLOOR_PX;
    feed(step(pace), step(pace), step(pace * JUMP_RATIO), step(pace));
    expect(dropped).toEqual([]);
    expect(total()).toBe(pace * (3 + JUMP_RATIO));
  });

  it('hands back a jump still held on reset and forgets the pace', () => {
    const { filter, feed, applied } = drag();
    const jump = step(JUMP_FLOOR_PX * 2);
    feed(jump);
    expect(filter.reset()).toEqual({ reason: 'isolated', steps: [jump] });
    expect(filter.reset()).toBeUndefined();
    feed(step(NORMAL_PX));
    expect(applied.at(-1)).toEqual({ dx: NORMAL_PX, dy: 0 });
  });
});
