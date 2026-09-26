import { describe, expect, it } from 'vitest';
import { chipPlacement } from '../src/view/tooltip.js';

const VIEWPORT_W = 1280;
const VIEWPORT_H = 800;
const CHIP_W = 120;
const CHIP_H = 24;

describe('chipPlacement', () => {
  it('sits below-right of a cursor in the open', () => {
    const at = chipPlacement(400, 300, CHIP_W, CHIP_H, VIEWPORT_W, VIEWPORT_H);
    expect(at.left).toBeGreaterThan(400);
    expect(at.top).toBeGreaterThan(300);
  });

  it('pulls in from the right edge', () => {
    const at = chipPlacement(VIEWPORT_W - 10, 300, CHIP_W, CHIP_H, VIEWPORT_W, VIEWPORT_H);
    expect(at.left + CHIP_W).toBeLessThan(VIEWPORT_W);
  });

  it('stands above the cursor when the bottom edge is near', () => {
    const y = VIEWPORT_H - 20;
    const at = chipPlacement(400, y, CHIP_W, CHIP_H, VIEWPORT_W, VIEWPORT_H);
    expect(at.top + CHIP_H).toBeLessThan(y);
  });

  it('never leaves the viewport at the top-left corner', () => {
    const at = chipPlacement(0, 0, CHIP_W, CHIP_H, VIEWPORT_W, VIEWPORT_H);
    expect(at.left).toBeGreaterThan(0);
    expect(at.top).toBeGreaterThan(0);
  });
});
