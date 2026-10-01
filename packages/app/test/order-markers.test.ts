import { describe, expect, it } from 'vitest';
import { createOrderMarkers, ORDER_MARKER_MS } from '../src/view/unit-controls/order-markers.js';

const SPOT = { col: 12, row: 8 };
const OTHER_SPOT = { col: 20, row: 4 };

function clocked() {
  let nowMs = 1000;
  const markers = createOrderMarkers(() => nowMs);
  return { markers, advance: (ms: number) => (nowMs += ms) };
}

describe('order markers', () => {
  it('plays a marker from its placement until it has run its length', () => {
    const { markers, advance } = clocked();
    markers.place(SPOT, 'move');
    expect(markers.live()).toEqual([{ id: 1, kind: 'move', hx: SPOT.col, hy: SPOT.row, progress: 0 }]);
    advance(ORDER_MARKER_MS / 2);
    expect(markers.live()[0]?.progress).toBeCloseTo(0.5);
    advance(ORDER_MARKER_MS / 2);
    expect(markers.live()).toEqual([]);
  });

  it('restarts a repeated order to the same spot instead of stacking a second marker', () => {
    const { markers, advance } = clocked();
    markers.place(SPOT, 'move');
    advance(ORDER_MARKER_MS / 2);
    markers.place(SPOT, 'move');
    markers.place(SPOT, 'attack');
    markers.place(OTHER_SPOT, 'move');
    const live = markers.live();
    expect(live.map((m) => [m.kind, m.hx, m.progress])).toEqual([
      ['move', SPOT.col, 0],
      ['attack', SPOT.col, 0],
      ['move', OTHER_SPOT.col, 0],
    ]);
    expect(new Set(live.map((m) => m.id)).size).toBe(live.length);
  });

  it('keeps only the newest markers of a long Shift-click chain', () => {
    const { markers } = clocked();
    for (let col = 0; col < 20; col++) markers.place({ col, row: 0 }, 'move');
    const live = markers.live();
    expect(live.length).toBeLessThan(20);
    expect(live.at(-1)?.hx).toBe(19);
  });
});
