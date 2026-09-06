import { describe, expect, it, vi } from 'vitest';
import { createGameHudScaleCoordinator } from '../src/view/runtime/game-hud-scale.js';

function target(apply: (scale: number) => Promise<void> = async () => undefined) {
  return { setUiScale: vi.fn(apply) };
}

describe('createGameHudScaleCoordinator', () => {
  it('moves every HUD target before advancing the perf offset', async () => {
    const targets = [target(), target(), target()];
    const placePerf = vi.fn();
    const coordinator = createGameHudScaleCoordinator({
      initialScale: 1,
      targets,
      placePerf,
      onError: vi.fn(),
    });

    await expect(coordinator.request(1.25)).resolves.toBe(true);

    for (const item of targets) expect(item.setUiScale).toHaveBeenCalledWith(1.25);
    expect(coordinator.currentScale()).toBe(1.25);
    expect(placePerf).toHaveBeenCalledWith(1.25);
  });

  it('rolls every target and the perf offset back when one replacement fails', async () => {
    const first = target();
    const failing = target(async (scale) => {
      if (scale === 1.25) throw new Error('GPU allocation failed');
    });
    const last = target();
    const placePerf = vi.fn();
    const onError = vi.fn();
    const coordinator = createGameHudScaleCoordinator({
      initialScale: 1,
      targets: [first, failing, last],
      placePerf,
      onError,
    });

    await expect(coordinator.request(1.25)).resolves.toBe(false);

    // Fail-fast forward pass: the target after the failure is never moved; every target rolls back.
    expect(first.setUiScale.mock.calls.map(([scale]) => scale)).toEqual([1.25, 1]);
    expect(failing.setUiScale.mock.calls.map(([scale]) => scale)).toEqual([1.25, 1]);
    expect(last.setUiScale.mock.calls.map(([scale]) => scale)).toEqual([1]);
    expect(coordinator.currentScale()).toBe(1);
    expect(placePerf).toHaveBeenLastCalledWith(1);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('applies targets one at a time in mount order, so stage stacking survives a rebuild', async () => {
    const order: string[] = [];
    let inFlight = 0;
    const tracked = (name: string) =>
      target(async () => {
        expect(inFlight).toBe(0); // sequential: no target starts while another is mid-remount
        inFlight++;
        await Promise.resolve();
        inFlight--;
        order.push(name);
      });
    const coordinator = createGameHudScaleCoordinator({
      initialScale: 1,
      targets: [tracked('toolPanel'), tracked('minimap'), tracked('controls')],
      placePerf: vi.fn(),
      onError: vi.fn(),
    });

    await expect(coordinator.request(1.25)).resolves.toBe(true);

    expect(order).toEqual(['toolPanel', 'minimap', 'controls']);
  });

  it('keeps retrying after a failed rollback instead of trusting the recorded scale', async () => {
    let failing = true;
    const sticky = target(async () => {
      if (failing) throw new Error('remount failed');
    });
    const onError = vi.fn();
    const coordinator = createGameHudScaleCoordinator({
      initialScale: 1,
      targets: [sticky],
      placePerf: vi.fn(),
      onError,
    });

    await expect(coordinator.request(1.25)).resolves.toBe(false);
    expect(onError).toHaveBeenCalledTimes(2); // the apply and the rollback both failed

    failing = false;
    // The target is stuck at an unknown scale; a repeat of the old request must not early-out.
    await expect(coordinator.request(1)).resolves.toBe(true);
    expect(coordinator.currentScale()).toBe(1);
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
      placePerf: vi.fn(),
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
