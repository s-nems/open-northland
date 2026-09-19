import { Container, type Mesh, Texture, TextureSource } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AtlasFrame } from '../../src/data/sprites/index.js';
import { MapObjectLayer, type MapObjectSprite } from '../../src/gpu/map-objects/index.js';
import { setWorldShadowStyle } from '../../src/gpu/pixel-art-registry.js';
import { DEFAULT_SHADOW_STYLE } from '../../src/gpu/shadow-style.js';
import { SHADOW_BLUR_PADDING as PAD } from '../../src/gpu/soft-shadow-cache.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import { useHeadlessShaderContext } from '../support/shader-context.js';
import { decorPositions, FRAME_0, FRAME_1, WIDE } from './support.js';

/**
 * Flat decor draws its silhouette twin as a quad of its own, in a container the renderer mounts under the
 * decor bodies, so a shadow never paints over a neighbouring decor body.
 */

const SHADOW_0: AtlasFrame = { x: 16, y: 0, width: 8, height: 4, offsetX: -2, offsetY: -4 };
const SHADOW_1: AtlasFrame = { x: 32, y: 8, width: 6, height: 2, offsetX: -1, offsetY: -2 };
const VERTICES_PER_QUAD = 4;
const FRAME_BOUND_FLOATS = 4;
/** A silhouette page of its own, sized unlike the body page so a lane mix-up shows in the UVs. */
const SHADOW_PAGE = new TextureSource({ width: 64, height: 32 });
const FLOATS_PER_QUAD = 8;
/** Far enough along x to land in another decor chunk. */
const FAR_CHUNK_X = 100_000;
const COLLAPSED = new Array<number>(FLOATS_PER_QUAD).fill(0);

function decor(x: number, shadowFrames?: readonly (AtlasFrame | undefined)[]): MapObjectSprite {
  return {
    x,
    y: 0,
    source: Texture.WHITE.source,
    frames: shadowFrames !== undefined && shadowFrames.length > 1 ? [FRAME_0, FRAME_1] : [FRAME_0],
    ...(shadowFrames !== undefined ? { shadow: { source: SHADOW_PAGE, frames: shadowFrames } } : {}),
    scale: 1,
    decor: true,
    phase: 0,
  };
}

function shadowMeshes(layer: MapObjectLayer): Mesh[] {
  return layer.decorShadowContainer.children.flatMap((chunk) => chunk.children) as Mesh[];
}

function onlyShadowMesh(layer: MapObjectLayer): Mesh {
  const [mesh] = shadowMeshes(layer);
  if (mesh === undefined) throw new Error('expected one decor shadow mesh');
  return mesh;
}

function shadowPositions(layer: MapObjectLayer): number[] {
  return [...(onlyShadowMesh(layer).geometry as unknown as { positions: Float32Array }).positions];
}

/** The texel bounds each vertex of the first shadow quad carries. */
function shadowFrameBounds(layer: MapObjectLayer): number[][] {
  const data = onlyShadowMesh(layer).geometry.getBuffer('aFrame').data;
  return Array.from({ length: VERTICES_PER_QUAD }, (_, v) => [
    ...data.slice(v * FRAME_BOUND_FLOATS, (v + 1) * FRAME_BOUND_FLOATS),
  ]);
}

useHeadlessShaderContext();
afterEach(() => setWorldShadowStyle(null));

describe('MapObjectLayer cast shadows (flat decor)', () => {
  it('writes a shadow quad at the silhouette frame, from the silhouette page, apart from the body quad', () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    layer.set([decor(10, [SHADOW_0])]);

    const [left, top, right, bottom] = [8 - PAD, -4 - PAD, 16 + PAD, PAD];
    expect(shadowPositions(layer)).toEqual([left, top, right, top, right, bottom, left, bottom]);
    const mesh = onlyShadowMesh(layer);
    expect((mesh.shader?.resources as { uTexture?: unknown } | undefined)?.uTexture).toBe(SHADOW_PAGE);
    const uvs = (mesh.geometry as unknown as { uvs: Float32Array }).uvs;
    const [u0, v0, u1, v1] = [(16 - PAD) / 64, -PAD / 32, (24 + PAD) / 64, (4 + PAD) / 32];
    expect([...uvs.slice(0, 6)]).toEqual([u0, v0, u1, v0, u1, v1]);
    expect(shadowFrameBounds(layer)).toEqual(new Array(VERTICES_PER_QUAD).fill([16, 0, 24, 4]));
    expect([...decorPositions(layer).slice(0, 2)]).toEqual([10, 0]);
    expect(layer.decorContainer.children[0]?.children).toHaveLength(1);
  });

  it('batches nothing for decor without a silhouette', () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    layer.set([decor(10)]);

    expect(shadowMeshes(layer)).toHaveLength(0);
  });

  it('collapses the shadow quad on a pose without a silhouette and restores it when the pose returns', () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    layer.set([decor(10, [SHADOW_0, undefined])]);

    layer.update(WIDE, 1);
    expect(shadowPositions(layer)).toEqual(COLLAPSED);

    layer.update(WIDE, 2);
    expect(shadowPositions(layer).slice(0, 2)).toEqual([8 - PAD, -4 - PAD]);
  });

  it("follows an animated silhouette's frame bounds from pose to pose", () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    layer.set([decor(10, [SHADOW_0, SHADOW_1])]);
    const upload = vi.spyOn(onlyShadowMesh(layer).geometry.getBuffer('aFrame'), 'update');

    layer.update(WIDE, 1);
    expect(shadowFrameBounds(layer)).toEqual(new Array(VERTICES_PER_QUAD).fill([32, 8, 38, 10]));
    expect(upload).toHaveBeenCalledOnce();
  });

  it('collapses the shadow quad with its removed object and keeps the sibling', () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    const removed = decor(10, [SHADOW_0]);
    layer.set([removed, decor(100, [SHADOW_0])]);

    layer.remove(removed);
    const positions = shadowPositions(layer);
    expect(positions.slice(0, FLOATS_PER_QUAD)).toEqual(COLLAPSED);
    expect(positions[FLOATS_PER_QUAD]).toBe(98 - PAD);
  });

  it('shades and softens the silhouettes while the enhancement is on, and draws them as authored once off', () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    layer.set([decor(10, [SHADOW_0])]);
    const style = (): { alpha: number[]; tint: number[]; soft: number | undefined } => {
      const resources = shadowMeshes(layer)[0]?.shader?.resources as
        | {
            shadowStyle: {
              uniforms: { uShadowAlpha: Float32Array; uShadowTint: Float32Array; uShadowSoft: number };
            };
          }
        | undefined;
      const uniforms = resources?.shadowStyle.uniforms;
      return {
        alpha: [...(uniforms?.uShadowAlpha ?? [])],
        tint: [...(uniforms?.uShadowTint ?? [])],
        soft: uniforms?.uShadowSoft,
      };
    };
    const authored = { alpha: [1, 1], tint: [0, 0, 0], soft: 0 };

    layer.update(WIDE, 0);
    expect(style()).toEqual(authored);

    setWorldShadowStyle({ ...DEFAULT_SHADOW_STYLE, alphaGain: 1.5, maxAlpha: 0.5, tint: 0xff8000 });
    layer.update(WIDE, 0);
    expect(style().alpha).toEqual([1.5, 0.5]);
    expect(style().soft).toBe(1);
    expect(style().tint.map((v) => Math.round(v * 0xff))).toEqual([0xff, 0x80, 0x00]);

    setWorldShadowStyle(null);
    layer.update(WIDE, 0);
    expect(style()).toEqual(authored);
  });

  it("keeps each chunk's shadow container paired by index with its body container", () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    const first = decor(10, [SHADOW_0]);
    layer.set([first, decor(FAR_CHUNK_X)]);
    const paired = (): boolean =>
      layer.decorShadowContainer.children.length === layer.decorContainer.children.length;
    expect(paired()).toBe(true);

    layer.add([decor(20, [SHADOW_0])]); // rebuilds the first chunk in place
    expect(paired()).toBe(true);
    expect(layer.decorShadowContainer.children[0]?.children).toHaveLength(1);

    layer.remove(first);
    layer.add([decor(FAR_CHUNK_X + 10, [SHADOW_0])]);
    expect(paired()).toBe(true);
    expect(layer.decorShadowContainer.children[1]?.children).toHaveLength(1);
  });

  it("culls a chunk's shadows with its bodies", () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    layer.set([decor(10, [SHADOW_0])]);

    layer.update({ minX: 5000, minY: 5000, maxX: 6000, maxY: 6000 }, 0);
    expect(layer.decorShadowContainer.children[0]?.visible).toBe(false);

    layer.update(WIDE, 0);
    expect(layer.decorShadowContainer.children[0]?.visible).toBe(true);
  });
});
