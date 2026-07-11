import { Container, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { AtlasFrame } from '../src/data/sprites/index.js';
import type { Viewport } from '../src/data/viewport.js';
import { MapObjectLayer, type MapObjectSprite } from '../src/gpu/map-objects/index.js';
import { TextureCache } from '../src/gpu/texture-cache.js';

/**
 * The static-layer REMOVAL seam of the `?map=` static→dynamic resource handover
 * ({@link MapObjectLayer.remove}): a first-worked node's built-once static drawing must come OUT and
 * stay out — a TALL object's pooled sprite detaches, a DECOR object's quad zeroes in place, and (the
 * regression a visual check would only catch by luck) an ANIMATED decor quad must not be written back
 * by the play-head rewrite on the next tick. Display objects construct headlessly (the chunk-batcher
 * test relies on the same), so the buffer states are pinnable without a GL context.
 */

const FRAME: AtlasFrame = { x: 0, y: 0, width: 8, height: 8, offsetX: 0, offsetY: 0 };
const FRAME_B: AtlasFrame = { x: 8, y: 0, width: 8, height: 8, offsetX: 0, offsetY: 0 };

/** A viewport that frames everything the tests place (world coords are single-digit px). */
const WIDE: Viewport = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };

function decorObject(x: number, frames: readonly AtlasFrame[]): MapObjectSprite {
  return { x, y: 0, source: Texture.WHITE.source, frames, scale: 1, decor: true, phase: 0 };
}

function tallObject(x: number): MapObjectSprite {
  return { x, y: 0, source: Texture.WHITE.source, frames: [FRAME], scale: 1, decor: false, phase: 0 };
}

/** The decor container's single mesh position buffer (one batch: same source, same still/moving split). */
function decorPositions(layer: MapObjectLayer): Float32Array {
  const mesh = layer.decorContainer.children[0]?.children[0] as { geometry?: { positions: Float32Array } };
  const positions = mesh?.geometry?.positions;
  if (positions === undefined) throw new Error('expected one decor batch mesh');
  return positions;
}

describe('MapObjectLayer.remove (the handover seam)', () => {
  it('zeroes a STILL decor quad in place and leaves its batch siblings intact', () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    const removed = decorObject(0, [FRAME]);
    const kept = decorObject(100, [FRAME]);
    layer.set([removed, kept]);
    layer.remove(removed);
    const positions = decorPositions(layer);
    // Quad 0 (the removed object) degenerate; quad 1 (the kept sibling) untouched.
    expect([...positions.slice(0, 8)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(positions[8]).toBe(100); // kept quad's x0 — still where writeObjectQuad put it
  });

  it('keeps an ANIMATED decor quad zeroed across play-head rewrites', () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    const removed = decorObject(0, [FRAME, FRAME_B]); // 2 frames → an animated batch member
    const kept = decorObject(100, [FRAME, FRAME_B]);
    layer.set([removed, kept]);
    layer.remove(removed);
    // Advance the animation clock twice — the rewrite loop must SKIP the removed (nulled) slot.
    layer.update(WIDE, 1);
    layer.update(WIDE, 2);
    const positions = decorPositions(layer);
    expect([...positions.slice(0, 8)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]); // never restored
    expect(positions[8]).toBe(100 + FRAME.offsetX); // the kept quad keeps being rewritten normally
  });

  it('detaches a TALL object sprite and never re-mints it on later updates', () => {
    const spriteLayer = new Container();
    const layer = new MapObjectLayer(spriteLayer, new TextureCache());
    const removed = tallObject(0);
    const kept = tallObject(50);
    layer.set([removed, kept]);
    layer.update(WIDE, 0); // both visible → both minted + attached
    expect(spriteLayer.children).toHaveLength(2);
    layer.remove(removed);
    expect(spriteLayer.children).toHaveLength(1);
    layer.update(WIDE, 1); // the removed member is gone from its block — nothing re-attaches it
    expect(spriteLayer.children).toHaveLength(1);
  });
});
