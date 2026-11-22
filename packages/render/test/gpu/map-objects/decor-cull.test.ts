import { Container, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { Viewport } from '../../../src/data/projection/index.js';
import type { AtlasFrame } from '../../../src/data/sprites/index.js';
import { MapObjectLayer, type MapObjectSprite } from '../../../src/gpu/map-objects/index.js';
import { TextureCache } from '../../../src/gpu/textures/texture-cache.js';
import { FRAME_0, FRAME_1 } from './support.js';

const FRAME_2: AtlasFrame = { ...FRAME_0, x: 16 };
const LOOP = [FRAME_0, FRAME_1, FRAME_2];
const SOURCE = Texture.WHITE.source;

/** A three-frame decor loop: the frame on screen at tick `t` is `LOOP[t % 3]`. */
const animated = (x: number, y: number): MapObjectSprite => ({
  x,
  y,
  decor: true,
  source: SOURCE,
  frames: LOOP,
  scale: 1,
  phase: 0,
});

/** A small view framing one anchor. */
const around = (x: number, y: number): Viewport => ({
  minX: x - 50,
  minY: y - 50,
  maxX: x + 50,
  maxY: y + 50,
});

/** Two objects in one chunk but far enough apart that one view frames only one of them, and a third
 *  across the map in a chunk of its own. */
const NEAR = animated(0, 0);
const SAME_CHUNK = animated(1000, 0);
const ACROSS = animated(20000, 10000);

function chunkMesh(layer: MapObjectLayer, chunk: number): { uvs: Float32Array } {
  const mesh = layer.decorContainer.children[chunk]?.children[0] as { geometry?: { uvs: Float32Array } };
  if (mesh?.geometry === undefined) throw new Error(`expected a batch mesh in decor chunk ${chunk}`);
  return mesh.geometry;
}

/** The loop frame a quad shows, read back off its first UV. */
function shownFrame(layer: MapObjectLayer, chunk: number, quad: number): number {
  const u0 = chunkMesh(layer, chunk).uvs[quad * 8] ?? Number.NaN;
  return LOOP.findIndex((frame) => frame.x === u0 * SOURCE.width);
}

describe('animated decor follows the view, not the chunk', () => {
  it('rewrites only the quads in view and catches up the ones a pan or a jump brings in', () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    layer.set([NEAR, SAME_CHUNK, ACROSS]);
    const [home, away] = [0, 1];
    const chunkVisible = (chunk: number) => layer.decorContainer.children[chunk]?.visible;

    layer.update(around(NEAR.x, NEAR.y), 1);
    expect([chunkVisible(home), chunkVisible(away)]).toEqual([true, false]);
    expect(shownFrame(layer, home, 0)).toBe(1);
    expect(shownFrame(layer, home, 1)).toBe(0); // same chunk, out of view: untouched
    expect(shownFrame(layer, away, 0)).toBe(0);

    // A pan within the same tick, as while paused.
    layer.update(around(SAME_CHUNK.x, SAME_CHUNK.y), 1);
    expect(shownFrame(layer, home, 1)).toBe(1);

    layer.update(around(ACROSS.x, ACROSS.y), 2);
    expect([chunkVisible(home), chunkVisible(away)]).toEqual([false, true]);
    expect(shownFrame(layer, away, 0)).toBe(2);
    expect([shownFrame(layer, home, 0), shownFrame(layer, home, 1)]).toEqual([1, 1]);

    layer.update(around(NEAR.x, NEAR.y), 2);
    expect([chunkVisible(home), chunkVisible(away)]).toEqual([true, false]);
    expect(shownFrame(layer, home, 0)).toBe(2);
    expect(shownFrame(layer, home, 1)).toBe(1);
    layer.destroy();
  });

  it('hides the shown chunks a framed pass misses and shows them again, leaving a culled one hidden', () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    layer.set([NEAR, SAME_CHUNK, ACROSS]);
    const [home, away] = [0, 1];
    const shown = () => [home, away].map((chunk) => layer.decorContainer.children[chunk]?.visible);
    const everything: Viewport = { minX: -1000, minY: -1000, maxX: 30000, maxY: 20000 };
    layer.update(everything, 1);
    expect(shown()).toEqual([true, true]);
    layer.hideDecorOutside(around(NEAR.x, NEAR.y));
    expect(shown()).toEqual([true, false]);
    layer.showDecor();
    expect(shown()).toEqual([true, true]);
    // A chunk the main cull hid is not the pass's to show.
    layer.update(around(ACROSS.x, ACROSS.y), 2);
    expect(shown()).toEqual([false, true]);
    layer.hideDecorOutside(around(NEAR.x, NEAR.y));
    layer.showDecor();
    expect(shown()).toEqual([false, true]);
  });
});
