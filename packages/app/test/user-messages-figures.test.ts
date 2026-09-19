import type { ResolvedLayer } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import { feetLine } from '../src/hud/tool-panel/messages/figures.js';

const HEIGHT = 50;
/** The usual gap under the feet (design px). */
const FEET_INSET = 6;
const ZOOM = 1;
const PIXEL_SCALE = 1;
/** A figure whose top sits 20 px above its feet. */
const FIGURE_TOP = -20;
const layers: readonly ResolvedLayer[] = [
  { frame: { offsetY: FIGURE_TOP } as ResolvedLayer['frame'], scale: 1 } as ResolvedLayer,
];

describe('notice figure feet line', () => {
  it('stands the feet 6 px above the bottom while the card is uncovered', () => {
    expect(feetLine(layers, HEIGHT, HEIGHT, ZOOM, PIXEL_SCALE)).toBe(HEIGHT - FEET_INSET);
  });

  it('lowers the figure on a covered card until its middle meets the middle of the visible strip', () => {
    const visible = 27;
    expect(feetLine(layers, HEIGHT, visible, ZOOM, PIXEL_SCALE)).toBe(HEIGHT - visible / 2 - FIGURE_TOP / 2);
    expect(feetLine(layers, HEIGHT, visible, ZOOM, PIXEL_SCALE)).toBeGreaterThan(HEIGHT - FEET_INSET);
  });

  it('never brings the feet closer than 2 px to the bottom edge', () => {
    expect(feetLine(layers, HEIGHT, 10, ZOOM, PIXEL_SCALE)).toBe(HEIGHT - 2);
  });
});
