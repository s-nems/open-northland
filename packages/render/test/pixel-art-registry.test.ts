import { Texture, TextureSource } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isMagnifiedTexture,
  isShadowTexture,
  markMagnifiedTexture,
  markPixelArtSource,
  markShadowTexture,
  pixelArtMagnifyMode,
  setPixelArtMagnification,
  setWorldShadowStyle,
  worldShadowStyle,
} from '../src/gpu/pixel-art-registry.js';
import { DEFAULT_SHADOW_STYLE } from '../src/gpu/shadow-style.js';

// The mode is module-global and the worker shares modules across files.
afterEach(() => {
  setPixelArtMagnification('off');
  setWorldShadowStyle(null);
});

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

  it('shades only marked textures, and only while a shadow style is set', () => {
    const page = new TextureSource({ width: 8, height: 8 });
    const silhouette = new Texture({ source: page });
    const body = new Texture({ source: page });
    markShadowTexture(silhouette);
    expect(isShadowTexture(silhouette)).toBe(true);
    expect(isShadowTexture(body)).toBe(false);
    // The style is what the batch shader compiles in; absent, a mark changes nothing.
    expect(worldShadowStyle()).toBeNull();
    setWorldShadowStyle(DEFAULT_SHADOW_STYLE);
    expect(worldShadowStyle()).toBe(DEFAULT_SHADOW_STYLE);
    silhouette.destroy();
    body.destroy();
    page.destroy();
  });
});
