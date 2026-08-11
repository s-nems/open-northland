import type { Camera } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import { uiScaleFor } from '../src/hud/ui-scale.js';
import { createGameViewportCoordinator, HUD_RESIZE_SETTLE_MS } from '../src/view/runtime/game-viewport.js';

function harness(
  pinnedUiScale: number | null = null,
  applyScale: (scale: number) => Promise<boolean> = async () => true,
) {
  let camera: Camera = { offsetX: 100, offsetY: 50, scale: 2 };
  let activeScale = pinnedUiScale ?? uiScaleFor(600);
  const cameras: Camera[] = [];
  const scales: number[] = [];
  const viewport = createGameViewportCoordinator({
    initialWidth: 800,
    initialHeight: 600,
    initialUiScaleFactor: 1,
    pinnedUiScale,
    camera: () => camera,
    setCamera: (next) => {
      camera = next;
      cameras.push(next);
    },
    currentUiScale: () => activeScale,
    requestUiScale: async (scale) => {
      scales.push(scale);
      const applied = await applyScale(scale);
      if (applied) activeScale = scale;
      return applied;
    },
  });
  return { viewport, cameras, scales };
}

describe('createGameViewportCoordinator', () => {
  it('recentres the camera and requests a changed responsive scale', () => {
    const { viewport, cameras, scales } = harness();
    expect(viewport.effectiveUiScale()).toBe(uiScaleFor(600));

    viewport.sync(1200, 900, 0);

    expect(cameras).toEqual([{ offsetX: 300, offsetY: 200, scale: 2 }]);
    expect(scales).toHaveLength(0);
    viewport.sync(1200, 900, HUD_RESIZE_SETTLE_MS);
    expect(scales).toEqual([uiScaleFor(900)]);
    expect(viewport.effectiveUiScale()).toBe(uiScaleFor(900));
  });

  it('ignores an unchanged size and skips scale requests when only width or a capped height changes', async () => {
    const { viewport, cameras, scales } = harness();
    viewport.sync(800, 600, 0);
    expect(cameras).toHaveLength(0);

    viewport.sync(1000, 600, 10);
    expect(cameras).toEqual([{ offsetX: 200, offsetY: 50, scale: 2 }]);
    expect(scales).toHaveLength(0);

    viewport.sync(1000, 1080, 20);
    viewport.sync(1000, 1080, 20 + HUD_RESIZE_SETTLE_MS);
    await Promise.resolve();
    await Promise.resolve();
    scales.length = 0;
    viewport.sync(1000, 1440, 30 + HUD_RESIZE_SETTLE_MS);
    viewport.sync(1000, 1440, 30 + HUD_RESIZE_SETTLE_MS * 2);
    expect(scales).toHaveLength(0);
  });

  it('settles a resize burst into one HUD scale request while reframing every size', () => {
    const { viewport, cameras, scales } = harness();

    viewport.sync(810, 610, 0);
    viewport.sync(810, 610, 30);
    viewport.sync(820, 620, 60);
    viewport.sync(820, 620, 90);
    viewport.sync(830, 630, 120);

    expect(cameras).toHaveLength(3);
    expect(scales).toHaveLength(0);

    viewport.sync(830, 630, 120 + HUD_RESIZE_SETTLE_MS - 1);
    expect(scales).toHaveLength(0);
    viewport.sync(830, 630, 120 + HUD_RESIZE_SETTLE_MS);

    expect(scales).toEqual([uiScaleFor(630)]);
  });

  it('restores the current scale when a newer resize reverses an active request', async () => {
    let finishFirst: ((applied: boolean) => void) | undefined;
    const { viewport, scales } = harness(null, () => {
      if (finishFirst !== undefined) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        finishFirst = resolve;
      });
    });

    viewport.sync(800, 900, 0);
    viewport.sync(800, 900, HUD_RESIZE_SETTLE_MS);
    viewport.sync(800, 600, HUD_RESIZE_SETTLE_MS + 1);
    viewport.sync(800, 600, HUD_RESIZE_SETTLE_MS * 2 + 1);

    expect(scales).toEqual([uiScaleFor(900), uiScaleFor(600)]);
    finishFirst?.(true);
    await Promise.resolve();
  });

  it('persists a responsive factor and requests its effective scale immediately', async () => {
    const { viewport, scales } = harness();
    await viewport.setUiScaleFactor(1.2);
    expect(viewport.uiScaleFactor()).toBe(1.2);
    expect(viewport.effectiveUiScale()).toBe(uiScaleFor(600, 1.2));
    expect(scales).toEqual([uiScaleFor(600, 1.2)]);
  });

  it('restores the committed factor after an older resize request finishes', async () => {
    let finishResize: ((applied: boolean) => void) | undefined;
    let requests = 0;
    const { viewport, scales } = harness(null, () =>
      ++requests === 1
        ? new Promise<boolean>((resolve) => {
            finishResize = resolve;
          })
        : Promise.resolve(true),
    );

    viewport.sync(800, 900, 0);
    viewport.sync(800, 900, HUD_RESIZE_SETTLE_MS);
    const commit = viewport.setUiScaleFactor(0.8);

    expect(scales).toEqual([uiScaleFor(900), uiScaleFor(900, 0.8)]);
    finishResize?.(true);
    await commit;

    expect(viewport.uiScaleFactor()).toBe(0.8);
    expect(scales).toEqual([uiScaleFor(900), uiScaleFor(900, 0.8)]);
  });

  it('allows a failed scale to be retried by the next explicit setting commit', async () => {
    const { viewport, scales } = harness(null, async () => false);

    await viewport.setUiScaleFactor(1.2);
    await viewport.setUiScaleFactor(1.2);

    expect(scales).toEqual([uiScaleFor(600, 1.2), uiScaleFor(600, 1.2)]);
  });

  it('rolls back the factor when an explicit scale request rejects', async () => {
    const { viewport } = harness(null, async () => {
      throw new Error('context lost');
    });

    await expect(viewport.setUiScaleFactor(1.2)).resolves.toBe(false);
    expect(viewport.uiScaleFactor()).toBe(1);
  });

  it('retries a failed automatic resize after another stable interval', async () => {
    let attempts = 0;
    const { viewport, scales } = harness(null, async () => ++attempts > 1);

    viewport.sync(800, 900, 0);
    viewport.sync(800, 900, HUD_RESIZE_SETTLE_MS);
    await new Promise((resolve) => setTimeout(resolve, 0));
    viewport.sync(800, 900, HUD_RESIZE_SETTLE_MS * 2);

    expect(scales).toEqual([uiScaleFor(900), uiScaleFor(900)]);
  });

  it('stops retrying a persistent automatic failure until the viewport changes again', async () => {
    const { viewport, scales } = harness(null, async () => false);

    viewport.sync(800, 900, 0);
    for (let interval = 1; interval <= 6; interval++) {
      viewport.sync(800, 900, HUD_RESIZE_SETTLE_MS * interval);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(scales).toHaveLength(4);

    viewport.sync(800, 700, HUD_RESIZE_SETTLE_MS * 7);
    viewport.sync(800, 700, HUD_RESIZE_SETTLE_MS * 8);
    expect(scales).toHaveLength(5);
  });

  it('skips a rebuild when the legibility floor swallows a factor change', async () => {
    const { viewport, scales } = harness();
    viewport.sync(800, 400, 0);
    viewport.sync(800, 400, HUD_RESIZE_SETTLE_MS);
    await Promise.resolve();
    await Promise.resolve();
    scales.length = 0;

    await viewport.setUiScaleFactor(0.6);

    expect(viewport.effectiveUiScale()).toBe(uiScaleFor(400, 0.6));
    expect(scales).toHaveLength(0);
  });

  it('keeps a positive absolute pin fixed while still reframing the camera', async () => {
    const { viewport, cameras, scales } = harness(1.75);
    expect(viewport.effectiveUiScale()).toBe(1.75);

    await viewport.setUiScaleFactor(1.4);
    viewport.sync(1200, 900, 0);

    expect(viewport.uiScaleFactor()).toBe(1.4);
    expect(viewport.effectiveUiScale()).toBe(1.75);
    expect(cameras).toEqual([{ offsetX: 300, offsetY: 200, scale: 2 }]);
    expect(scales).toHaveLength(0);
  });
});
