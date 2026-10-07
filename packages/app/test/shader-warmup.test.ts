import { expect, it, vi } from 'vitest';
import { enhancementsOf } from '../src/view/graphics-enhancements.js';
import { defaultSettings } from '../src/view/settings-store.js';
import { applyEnhancementsWarmed, graphicsShaderWarmup } from '../src/view/shader-warmup.js';

it('shares one warm-up per settings and starts another when they change', async () => {
  const first = graphicsShaderWarmup();
  expect(graphicsShaderWarmup()).toBe(first);
  expect(await first.done).toEqual([]);
});

it('applies a live enhancement change once its programs are warmed, the latest change only', async () => {
  const apply = vi.fn();
  const applyWarmed = applyEnhancementsWarmed(apply);
  const sharp = { ...enhancementsOf(defaultSettings()), pixelArtScaler: 'sharp' as const };
  const plain = { ...enhancementsOf(defaultSettings()), enhancedSampling: false };
  applyWarmed(sharp);
  applyWarmed(plain);
  expect(apply).not.toHaveBeenCalled();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply).toHaveBeenCalledWith(plain);
});
