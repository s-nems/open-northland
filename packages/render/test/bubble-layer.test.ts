import { type Container, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { AtlasFrame } from '../src/data/sprites/index.js';
import {
  type SettlerBubble,
  type SettlerBubbleFrame,
  SettlerBubbleLayer,
} from '../src/gpu/overlays/bubble-layer.js';
import type { DrawnGeometry } from '../src/gpu/sprite-pool/index.js';
import { TextureCache } from '../src/gpu/texture-cache.js';
import { makeElevationField, ONE, tileToScreen } from '../src/index.js';

/**
 * The bubble hangs off whichever head estimate is available, in a strict order: the pool's drawn sprite
 * box (top edge, horizontally centred), else its drawn feet anchor raised by a body height, else the raw
 * snapshot projection raised the same way plus the terrain lift. Only the last survives a settler the pool
 * did not draw (culled off-screen, or standing inside a house). Pixi `Container`/`Sprite` build without a
 * GL context, so the resulting world-space position is checkable headless.
 */

const SOURCE = new TextureSource({ width: 64, height: 64 });
const FRAME: AtlasFrame = { x: 0, y: 0, width: 64, height: 32, offsetX: 0, offsetY: 0 };

const GFX = {
  source: SOURCE,
  frameByKind: { child: FRAME, partner: FRAME, hungry: FRAME, sleepy: FRAME },
  textures: new TextureCache(),
};

/** Mirrors the layer's own constants — a bubble tip floats BUBBLE_GAP above the head estimate, and the
 *  feet-anchor fallback puts the head HEAD_ABOVE_FEET above the feet. */
const BUBBLE_GAP = 6;
const HEAD_ABOVE_FEET = 40;

const bubble = (tileX: number, tileY: number): SettlerBubble => ({
  id: 1,
  x: tileX * ONE,
  y: tileY * ONE,
  kind: 'child',
});

const drawnWith = (geometry: Partial<DrawnGeometry>): DrawnGeometry => ({
  boundsOf: () => undefined,
  anchorOf: () => undefined,
  ...geometry,
});

function tipOf(frame: SettlerBubbleFrame): { x: number; y: number } {
  const layer = new SettlerBubbleLayer();
  layer.setGfx(GFX);
  layer.draw(frame);
  const node = layer.container.children[0] as Container;
  return { x: node.position.x, y: node.position.y };
}

describe('SettlerBubbleLayer head anchoring', () => {
  it('prefers the drawn sprite box: centred horizontally, floating above its top edge', () => {
    const bounds = { minX: 100, minY: 40, maxX: 140, maxY: 100 };
    const tip = tipOf({ bubbles: [bubble(3, 5)], drawn: drawnWith({ boundsOf: () => bounds }) });
    expect(tip.x).toBe(120); // box centre, NOT the raw projection
    expect(tip.y).toBe(40 - BUBBLE_GAP); // box top edge
  });

  it('falls back to the drawn feet anchor raised a body height when no box was stamped', () => {
    const tip = tipOf({
      bubbles: [bubble(3, 5)],
      drawn: drawnWith({ anchorOf: () => ({ x: 200, y: 300 }) }),
    });
    expect(tip.x).toBe(200);
    expect(tip.y).toBe(300 - HEAD_ABOVE_FEET - BUBBLE_GAP);
  });

  it('falls back to the raw snapshot projection plus terrain lift for an undrawn settler', () => {
    // Nothing drawn (culled off-screen / indoors) — the bubble must still appear over the settler's tile.
    const flat = tipOf({ bubbles: [bubble(3, 5)], drawn: drawnWith({}) });
    const p = tileToScreen(3, 5);
    expect(flat.x).toBe(p.x);
    expect(flat.y).toBe(p.y - HEAD_ABOVE_FEET - BUBBLE_GAP);
  });

  it('rides the same terrain lift the sprite pool applies on sloped ground', () => {
    // A hill under cell (0,0): the raw-projection fallback must climb it by exactly the field's lift.
    const elevation = makeElevationField([160, 160, 160, 160], 2, 2);
    const tip = tipOf({ bubbles: [bubble(0, 0)], drawn: drawnWith({}), elevation });
    const p = tileToScreen(0, 0);
    expect(tip.y).toBeCloseTo(p.y - elevation.liftAt(0, 0) - HEAD_ABOVE_FEET - BUBBLE_GAP, 6);
    expect(elevation.liftAt(0, 0)).toBeGreaterThan(0); // the lift is real, not a flat-field no-op
  });

  it('omits the drawn seam entirely without throwing (the no-pool path)', () => {
    const tip = tipOf({ bubbles: [bubble(3, 5)] });
    const p = tileToScreen(3, 5);
    expect(tip.y).toBe(p.y - HEAD_ABOVE_FEET - BUBBLE_GAP);
  });
});
