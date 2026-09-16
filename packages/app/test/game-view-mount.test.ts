import type { SoundDriver } from '@open-northland/audio';
import { Simulation } from '@open-northland/sim';
import { afterEach, expect, it, vi } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import { currentDiagGameSession, setDiagGameSession } from '../src/diag/session.js';
import * as toolPanel from '../src/view/game-tool-panel.js';
import * as perfOverlay from '../src/view/perf-overlay.js';
import * as presentation from '../src/view/runtime/game-presentation.js';
import { type GameViewDeps, startGameView } from '../src/view/runtime/game-view.js';
import * as tooltips from '../src/view/tooltip.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setDiagGameSession(null);
});

it.each([
  false,
  true,
])('releases a failed mount before another attempt (cleanup throws: %s)', async (cleanupThrows) => {
  vi.stubGlobal('window', { location: { search: '' } });
  const live = new Set<string>();
  const acquire = (name: string) => {
    expect(live.has(name)).toBe(false);
    live.add(name);
    return () => live.delete(name);
  };
  vi.spyOn(presentation, 'mountGamePresentation').mockImplementation(
    async (_params, _renderer, _music, signal) => {
      const releaseBinding = acquire('sound binding');
      signal?.addEventListener('abort', releaseBinding, { once: true });
      return { close: acquire('sound') } as unknown as SoundDriver;
    },
  );
  vi.spyOn(perfOverlay, 'mountPerfOverlay').mockImplementation(() => ({
    dispose: acquire('perf'),
    update() {},
    place() {},
    setVisible() {},
  }));
  vi.spyOn(tooltips, 'createTooltip').mockImplementation(() => {
    const release = acquire('tooltip');
    return {
      show() {},
      hide() {},
      destroy() {
        release();
        if (cleanupThrows) throw new Error('tooltip cleanup failed');
      },
    };
  });
  const failure = new Error('tool-panel asset failed');
  vi.spyOn(toolPanel, 'mountGameToolPanel').mockRejectedValue(failure);

  for (let attempt = 0; attempt < 2; attempt++) {
    const sim = new Simulation({ seed: 7, content: testContent() });
    setDiagGameSession({ entry: 'scene', worldId: 'mount-test', seed: 7, sim, hashTrace: null });
    const deps = {
      sim,
      params: new URLSearchParams(),
      canvas: new EventTarget(),
      initialViewport: { width: 1000, height: 600 },
      cameraCtl: { dispose: acquire('camera') },
      driver: {},
      saveEntrySearch: '?scene=mount-test',
      mapSize: { width: 10, height: 10 },
    } as unknown as GameViewDeps;
    const mount = startGameView(deps);
    if (cleanupThrows) {
      await expect(mount).rejects.toMatchObject({ errors: [failure, expect.any(AggregateError)] });
    } else {
      await expect(mount).rejects.toBe(failure);
    }
    expect(live).toEqual(new Set());
    expect(currentDiagGameSession()).toBeNull();
  }
});
