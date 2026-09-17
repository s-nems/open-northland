import { Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import {
  isMagnifiedTexture,
  markMagnifiedTexture,
  markPixelArtSource,
  onPixelArtMagnifyMode,
  pixelArtMagnifyMode,
  setPixelArtMagnification,
} from '../src/gpu/pixel-art-registry.js';

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

  it('publishes the shader mode of each scaler to its listeners', () => {
    const seen: number[] = [];
    onPixelArtMagnifyMode((mode) => seen.push(mode));
    setPixelArtMagnification('xbr');
    setPixelArtMagnification('sharp');
    setPixelArtMagnification('bilinear');
    expect(seen).toEqual([2, 1, 0]);
    expect(pixelArtMagnifyMode()).toBe(0);
  });
});
