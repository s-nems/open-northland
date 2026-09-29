import { Container, Mesh, Texture, UniformGroup } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { WEATHER_SECTOR_NODES } from '../../src/data/weather/field.js';
import { MapObjectLayer, type MapObjectSprite } from '../../src/gpu/map-objects/index.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import { useHeadlessShaderContext } from '../support/shader-context.js';
import { FRAME_0 } from './support.js';

/**
 * Shaded flat decor takes the snow cover of the ground it stands on: the quad carries its anchor once at
 * build, and one shared switch turns the dusting on for every batch without touching a quad again.
 */

const VERTICES_PER_QUAD = 4;
const ANCHOR_FLOATS = 2;
const LIFT = 6;

function shadedDecor(x: number, y: number): MapObjectSprite {
  return {
    x,
    y,
    source: Texture.WHITE.source,
    frames: [FRAME_0],
    scale: 1,
    decor: true,
    phase: 0,
    brightness: 1,
    lift: LIFT,
  };
}

function onlyBodyMesh(layer: MapObjectLayer): Mesh {
  const mesh = layer.decorContainer.children[0]?.children[0];
  if (!(mesh instanceof Mesh)) throw new Error('expected one decor body mesh');
  return mesh;
}

useHeadlessShaderContext();

describe('decor weather cover', () => {
  it('writes each quad its drawn feet anchor, constant over its four vertices', () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    layer.set([shadedDecor(10, 20), shadedDecor(30, 40)]);
    const anchors = onlyBodyMesh(layer).geometry.getBuffer('aAnchor').data;
    expect(anchors).toHaveLength(2 * VERTICES_PER_QUAD * ANCHOR_FLOATS);
    expect([...anchors.slice(0, ANCHOR_FLOATS)]).toEqual([10, 20 - LIFT]);
    const secondQuad = VERTICES_PER_QUAD * ANCHOR_FLOATS;
    expect([...anchors.slice(secondQuad + ANCHOR_FLOATS, secondQuad + 2 * ANCHOR_FLOATS)]).toEqual([
      30,
      40 - LIFT,
    ]);
    layer.destroy();
  });

  it('switches every batch on and off through one shared group, rebinding a resized grid', () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    layer.set([shadedDecor(10, 20)]);
    const shader = onlyBodyMesh(layer).shader;
    const group = shader?.resources.decorCoverVars;
    if (!(group instanceof UniformGroup)) throw new Error('Missing decor cover uniforms');
    expect(group.uniforms.uCover).toBe(0);
    const sectorsX = 3;
    const sectorsY = 2;
    layer.setWeatherCover(new Uint8Array(sectorsX * sectorsY * 4), sectorsX, sectorsY);
    expect(group.uniforms.uCover).toBe(1);
    expect(Array.from(group.uniforms.uCoverNodeScale as Float32Array)).toEqual([
      Math.fround(1 / (sectorsX * WEATHER_SECTOR_NODES)),
      Math.fround(1 / (sectorsY * WEATHER_SECTOR_NODES)),
    ]);
    expect(shader?.resources.uCoverTex?.width).toBe(sectorsX);
    // A block built after the cover arrived binds the current grid too.
    layer.add([shadedDecor(100_000, 20)]);
    const late = layer.decorContainer.children.at(-1)?.children[0];
    if (!(late instanceof Mesh)) throw new Error('expected a late decor body mesh');
    expect(late.shader?.resources.uCoverTex).toBe(shader?.resources.uCoverTex);
    layer.setWeatherCover(null, 0, 0);
    expect(group.uniforms.uCover).toBe(0);
    // The dusting sits behind the per-vertex switch, so a dry map keeps its single fetch.
    expect(shader?.glProgram?.fragment).toContain('if (vSnow > 0.0)');
    layer.destroy();
  });
});
