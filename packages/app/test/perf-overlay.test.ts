import { afterEach, expect, it, vi } from 'vitest';
import { FrameStats } from '../src/diag/frame-stats.js';
import { mountPerfOverlay } from '../src/view/perf-overlay.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('folds the frame stats and reads the connection only while the readout shows', () => {
  const panel = { style: {} as Record<string, string>, textContent: '', remove: () => undefined };
  vi.stubGlobal('document', { createElement: () => panel, body: { append: () => undefined } });
  const stats = new FrameStats();
  stats.record({
    elapsedMs: 16,
    tick: 3,
    steps: 1,
    droppedTicks: 0,
    speed: 1,
    paused: false,
    entities: 0,
    cpuMs: 4,
    simMs: 1,
    snapMs: 1,
    drawMs: 2,
    drawn: 0,
    pooled: 0,
  });
  let reads = 0;
  const report = () => {
    reads++;
    return stats.report();
  };
  const overlay = mountPerfOverlay(0, 0, 0);

  overlay.update(report, () => null);
  expect(reads).toBe(0);

  overlay.setVisible(true);
  overlay.update(report, () => null);
  expect(reads).toBe(1);
  expect(panel.textContent).not.toBe('');
});
