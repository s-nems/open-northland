import { CanvasSource, type TextureSource } from 'pixi.js';
import type { AtlasFrame, SettlerStateBinding, SpriteAtlas, SpriteBindings } from '../data/sprites/index.js';

/**
 * A synthetic sprite atlas that exercises the textured sub-rect draw branch without copyrighted game
 * data: real bob atlases are decoded from the mod and gitignored, so a committed harness
 * cannot bind them. It stands in one flat coloured marker frame per drawable sprite kind, and binds
 * through the same `SpriteSheet` shape a real atlas does.
 */

/** Sheet dimensions in pixels, two rows tall so the settler's per-state frames and the
 *  building/resource frames fit without overlap. */
export const SYNTHETIC_ATLAS_WIDTH = 64;
export const SYNTHETIC_ATLAS_HEIGHT = 96;

/**
 * The bob ids the synthetic bindings reference. Arbitrary small integers - a synthetic atlas has no
 * `.bmd` `firstBobId`, so these only have to agree between the frame table and the bindings. The settler
 * gets one bob per sprite state so the per-state binding path is exercised.
 */
const SETTLER_IDLE_BOB = 1;
const BUILDING_BOB = 2;
const RESOURCE_BOB = 3;
const SETTLER_MOVING_BOB = 4;
const SETTLER_ACTING_BOB = 5;

/** Colour lives here rather than in {@link AtlasFrame} because a real atlas carries pixels, not a fill. */
interface SyntheticFrame {
  readonly bobId: number;
  readonly frame: AtlasFrame;
  readonly colour: string;
}

/**
 * The synthetic frames, laid out in the atlas sheet with a 1px gutter so a textured sub-rect never
 * samples a neighbour's edge. Each kind gets one marker frame offset so its bottom-centre sits at the
 * feet anchor (`offsetX = -w/2`, `offsetY = -h`), matching the placeholder geometry's feet placement.
 * Each settler state carries its own tint so the states read apart on screen.
 */
const SYNTHETIC_FRAMES: readonly SyntheticFrame[] = [
  {
    bobId: SETTLER_IDLE_BOB,
    frame: { x: 1, y: 1, width: 12, height: 24, offsetX: -6, offsetY: -24 },
    colour: '#e8e0d0',
  },
  {
    bobId: BUILDING_BOB,
    frame: { x: 15, y: 1, width: 28, height: 40, offsetX: -14, offsetY: -40 },
    colour: '#c8a04a',
  },
  {
    bobId: RESOURCE_BOB,
    frame: { x: 45, y: 1, width: 16, height: 28, offsetX: -8, offsetY: -28 },
    colour: '#2f7d32',
  },
  {
    bobId: SETTLER_MOVING_BOB,
    frame: { x: 1, y: 42, width: 12, height: 24, offsetX: -6, offsetY: -24 },
    colour: '#7da7d9',
  },
  {
    bobId: SETTLER_ACTING_BOB,
    frame: { x: 15, y: 42, width: 12, height: 24, offsetX: -6, offsetY: -24 },
    colour: '#d98a52',
  },
];

/** No `byAtomic`: the synthetic atlas has one generic action frame, not a per-atomic art set. */
const SYNTHETIC_SETTLER_BINDING: SettlerStateBinding = {
  idle: SETTLER_IDLE_BOB,
  moving: SETTLER_MOVING_BOB,
  acting: SETTLER_ACTING_BOB,
};

export const SYNTHETIC_BINDINGS: SpriteBindings = {
  settler: SYNTHETIC_SETTLER_BINDING,
  building: BUILDING_BOB,
  resource: RESOURCE_BOB,
};

/** The screen-free half, unit-testable without a canvas; {@link createSyntheticAtlasSource} paints it. */
export function syntheticAtlasFrames(): SpriteAtlas {
  const frames = new Map<number, AtlasFrame>();
  for (const f of SYNTHETIC_FRAMES) frames.set(f.bobId, f.frame);
  return { width: SYNTHETIC_ATLAS_WIDTH, height: SYNTHETIC_ATLAS_HEIGHT, frames };
}

/**
 * Draw the synthetic frames into an offscreen canvas and wrap it as a Pixi {@link TextureSource}; the
 * sheet is transparent outside the frames. Takes a `document` so the same code path runs under the
 * browser entry, and throws when no 2D context is available - an environment error, not a recoverable
 * boundary failure.
 */
export function createSyntheticAtlasSource(doc: Document = document): TextureSource {
  const canvas = doc.createElement('canvas');
  canvas.width = SYNTHETIC_ATLAS_WIDTH;
  canvas.height = SYNTHETIC_ATLAS_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('synthetic atlas: 2D canvas context unavailable');
  for (const { frame, colour } of SYNTHETIC_FRAMES) {
    ctx.fillStyle = colour;
    ctx.fillRect(frame.x, frame.y, frame.width, frame.height);
  }
  return new CanvasSource({ resource: canvas, scaleMode: 'nearest' });
}
