import { describe, expect, it, vi } from 'vitest';
import { createGameHudScaleCoordinator } from '../src/view/runtime/game-hud-scale.js';

function target(apply: (scale: number) => Promise<void> = async () => undefined) {
  return { setUiScale: vi.fn(apply) };
}

describe('createGameHudScaleCoordinator', () => {
  it('moves every HUD target before advancing the perf offset', async () => {
    const targets = [target(), target(), target()];
    const setPerfLeft = vi.fn();
    const coordinator = createGameHudScaleCoordinator({
      initialScale: 1,
      targets,
      setPerfLeft,
      onError: vi.fn(),
    });

    await expect(coordinator.request(1.25)).resolves.toBe(true);

    for (const item of targets) expect(item.setUiScale).toHaveBeenCalledWith(1.25);
    expect(coordinator.currentScale()).toBe(1.25);
    expect(setPerfLeft).toHaveBeenCalledWith(1.25);
  });

  it('rolls every target and the perf offset back when one replacement fails', async () => {
    const first = target();
    const failing = target(async (scale) => {
      if (scale === 1.25) throw new Error('GPU allocation failed');
    });
    const last = target();
    const setPerfLeft = vi.fn();
    const onError = vi.fn();
    const coordinator = createGameHudScaleCoordinator({
      initialScale: 1,
      targets: [first, failing, last],
      setPerfLeft,
      onError,
    });

    await expect(coordinator.request(1.25)).resolves.toBe(false);

    for (const item of [first, failing, last]) {
      expect(item.setUiScale.mock.calls.map(([scale]) => scale)).toEqual([1.25, 1]);
    }
    expect(coordinator.currentScale()).toBe(1);
    expect(setPerfLeft).toHaveBeenLastCalledWith(1);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('serializes scale requests so a later result cannot be overwritten', async () => {
    let release = (): void => undefined;
    const slow = target(
      (scale) =>
        new Promise<void>((resolve) => {
          if (scale === 1.1) release = resolve;
          else resolve();
        }),
    );
    const coordinator = createGameHudScaleCoordinator({
      initialScale: 1,
      targets: [slow],
      setPerfLeft: vi.fn(),
      onError: vi.fn(),
    });

    const first = coordinator.request(1.1);
    const second = coordinator.request(1.2);
    await vi.waitFor(() => expect(slow.setUiScale).toHaveBeenCalledOnce());
    expect(slow.setUiScale.mock.calls.map(([scale]) => scale)).toEqual([1.1]);

    release();
    await Promise.all([first, second]);

    expect(slow.setUiScale.mock.calls.map(([scale]) => scale)).toEqual([1.1, 1.2]);
    expect(coordinator.currentScale()).toBe(1.2);
  });
});
