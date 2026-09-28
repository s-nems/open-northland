import { rasterizeTerrain, type SceneTerrain } from '@open-northland/render';
import { BufferImageSource, Container, Sprite } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { createMinimapSurface, RASTER_OVERSAMPLE } from '../src/hud/minimap/surface.js';

const TERRAIN: SceneTerrain = { width: 4, height: 4, typeIds: Array.from({ length: 16 }, () => 0) };

describe('Atlas ground surface', () => {
  it('keeps the actual terrain palette and rebakes only when the display resolution changes', () => {
    const host = new Container();
    let resolution = 1;
    const surface = createMinimapSurface({
      container: host,
      terrain: TERRAIN,
      map: { x: 0, y: 0, w: 52, h: 42 },
      colourOf: () => 0x426f32,
      resolution: () => resolution,
    });
    const ground = host.children[0];
    if (!(ground instanceof Sprite)) throw new Error('missing ground');
    const first = ground.texture;
    if (!(first.source instanceof BufferImageSource)) throw new Error('missing pixel source');
    expect(first.source.resource).toEqual(rasterizeTerrain(TERRAIN, () => 0x426f32, 104, 84));
    host.scale.set(2);
    host.position.set(19, 24);
    surface.syncResolution();
    expect(ground.texture).toBe(first);
    resolution = 2;
    surface.syncResolution();
    expect(first.destroyed).toBe(true);
    expect(ground.texture.width).toBe(52 * RASTER_OVERSAMPLE * 2);
    expect(ground.texture.height).toBe(42 * RASTER_OVERSAMPLE * 2);
    expect(ground.width).toBe(52);
    expect(ground.height).toBe(42);
    const last = ground.texture;
    surface.dispose();
    expect(last.destroyed).toBe(true);
    expect(host.children).toHaveLength(0);
    host.destroy();
  });
});
