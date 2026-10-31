import { describe, expect, it } from 'vitest';
import { filmStep, layoutFilm } from '../../../../src/hud/dom/knowledge/motion.js';

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
