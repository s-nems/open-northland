import { Texture, TextureSource } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isMagnifiedTexture,
  markMagnifiedTexture,
  markPixelArtSource,
  pixelArtMagnifyMode,
  setPixelArtMagnification,
} from '../src/gpu/pixel-art-registry.js';

// The mode is module-global and the worker shares modules across files.
afterEach(() => setPixelArtMagnification('off'));

describe('pixel-art registry', () => {
  it('magnifies only textures minted from a marked page', () => {
    const page = new TextureSource({ width: 8, height: 8 });
    const other = new TextureSource({ width: 8, height: 8 });
    markPixelArtSource(page);
    const fromPage = new Texture({ source: page });
    const fromOther = new Texture({ source: other });
    const bake = new Texture({ source: other });
    markMagnifiedTexture(fromPage);
    markMagnifiedTexture(fromOther);
    markMagnifiedTexture(bake, page); // a bake derived from the marked page
    expect(isMagnifiedTexture(fromPage)).toBe(true);
    expect(isMagnifiedTexture(fromOther)).toBe(false);
    expect(isMagnifiedTexture(bake)).toBe(true);
    fromPage.destroy();
    fromOther.destroy();
    bake.destroy();
    page.destroy();
    other.destroy();
  });

  it('maps off and each scaler onto the compiled shader mode', () => {
    expect(pixelArtMagnifyMode()).toBe(0);
    setPixelArtMagnification('xbr');
    expect(pixelArtMagnifyMode()).toBe(3);
    setPixelArtMagnification('sharp');
    expect(pixelArtMagnifyMode()).toBe(2);
    setPixelArtMagnification('bilinear');
    expect(pixelArtMagnifyMode()).toBe(1);
    setPixelArtMagnification('off');
    expect(pixelArtMagnifyMode()).toBe(0);
  });
});
