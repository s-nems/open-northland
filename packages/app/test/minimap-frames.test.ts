import { expect, it } from 'vitest';
import { DEFAULT_MINIMAP_FRAME, MINIMAP_FRAMES } from '../src/hud/minimap/frames.js';
import { parseStoredSettings } from '../src/view/settings-store.js';

it('starts with the iron frame and keeps only a frame the game draws', () => {
  expect(DEFAULT_MINIMAP_FRAME).toBe('zelazo');
  expect(parseStoredSettings(null).minimapFrame).toBe('zelazo');
  expect(parseStoredSettings('{"minimapFrame":"atlas"}').minimapFrame).toBe('zelazo');
  for (const minimapFrame of MINIMAP_FRAMES) {
    expect(parseStoredSettings(JSON.stringify({ minimapFrame })).minimapFrame).toBe(minimapFrame);
  }
});
