import { TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { TextureCache } from '../src/gpu/texture-cache.js';
import { WorldChrome } from '../src/gpu/world-renderer/world-chrome.js';

function atlas(cache: TextureCache, scaleMode: 'nearest' | 'linear'): TextureSource {
  const source = new TextureSource({ width: 8, height: 8, scaleMode });
  cache.get(source, { x: 0, y: 0, width: 8, height: 8, offsetX: 0, offsetY: 0 });
  return source;
}

describe('world sprite smoothing', () => {
  it('keeps sampling disabled at every zoom', () => {
    const cache = new TextureCache();
    const source = atlas(cache, 'nearest');
    const chrome = new WorldChrome(cache, false, false);
    for (const zoom of [2, 0.5, 1]) {
      chrome.applyWorldSampling(zoom);
      expect(source.scaleMode).toBe('nearest');
    }
    chrome.destroy();
    cache.clear();
    source.destroy();
  });

  it('restores only pages it changed, leaving authored linear art alone', () => {
    const cache = new TextureCache();
    const pixelArt = atlas(cache, 'nearest');
    const paintedArt = atlas(cache, 'linear');
    const chrome = new WorldChrome(cache, false, true);
    chrome.applyWorldSampling(0.5);
    expect(pixelArt.scaleMode).toBe('linear');
    chrome.applyWorldSampling(1);
    expect(pixelArt.scaleMode).toBe('nearest');
    expect(paintedArt.scaleMode).toBe('linear');
    chrome.applyWorldSampling(0.5);
    chrome.destroy();
    expect(pixelArt.scaleMode).toBe('nearest');
    expect(paintedArt.scaleMode).toBe('linear');
    cache.clear();
    pixelArt.destroy();
    paintedArt.destroy();
  });
});
