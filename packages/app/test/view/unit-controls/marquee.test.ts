// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createSelectionMarquee } from '../../../src/view/unit-controls/marquee.js';

/** A camera that only pans: world = client - offset. */
function pannedProjection() {
  const camera = { x: 0, y: 0 };
  return {
    camera,
    projection: {
      toWorld: (x: number, y: number) => ({ x: x - camera.x, y: y - camera.y }),
      toClient: (x: number, y: number) => ({ x: x + camera.x, y: y + camera.y }),
    },
  };
}

const SCROLL = 200;

describe('createSelectionMarquee', () => {
  it('keeps the start corner on the world point pressed while the camera scrolls', () => {
    const { camera, projection } = pannedProjection();
    const marquee = createSelectionMarquee(projection);
    marquee.begin(100, 100);
    camera.x -= SCROLL; // the view scrolls right, so the pressed ground slides left on screen
    marquee.update(100, 100);
    const box = document.body.lastElementChild as HTMLElement;
    expect(box.style.left).toBe(`${100 - SCROLL}px`);
    expect(box.style.width).toBe(`${SCROLL}px`);
    expect(marquee.release(100, 100)).toEqual({ start: { x: 100, y: 100 }, moved: true });
    marquee.dispose();
  });

  it('treats a press released in place under a still camera as a click', () => {
    const { projection } = pannedProjection();
    const marquee = createSelectionMarquee(projection);
    marquee.begin(50, 50);
    expect(marquee.release(52, 51)?.moved).toBe(false);
    expect(marquee.active()).toBe(false);
    marquee.dispose();
  });
});
