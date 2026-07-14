import { CanvasSource, type TextureSource } from 'pixi.js';
import type { AtlasFrame, SettlerStateBinding, SpriteAtlas, SpriteBindings } from '../data/sprites/index.js';

/**
 * A synthetic sprite atlas that exercises the textured sub-rect branch of
 * {@link import('./sprite-pool/index.js').SpritePool} without copyrighted game data: real bob atlases are
 * decoded from an owned game copy and gitignored (AGENTS.md "Legal guardrails"), so a committed,
 * reproducible harness cannot bind them. It stands in a few flat coloured marker frames — one per
 * drawable {@link import('../data/sprites/index.js').SpriteKind} — drawn procedurally into a canvas, so a
 * human can eyeball that the textured branch projects and depth-sorts correctly (frames land at their
 * feet anchor, occlude back-to-front). Real atlases bind through the same {@link SpriteSheet} shape.
 *
 * The split mirrors `sprites.ts`: the frame geometry ({@link syntheticAtlasFrames}) is pure data,
 * unit-testable without a screen; drawing it into a GPU {@link TextureSource}
 * ({@link createSyntheticAtlasSource}) is the pixel half, deferred to a human eye.
 */

/**
 * The synthetic atlas sheet dimensions in pixels. Two rows tall so the settler's three per-state
 * frames and the building/resource frames all fit without overlap: the tallest top-row frame, the
 * 40px building, reaches y=41, and the bottom row starts at y=42.
 */
export const SYNTHETIC_ATLAS_WIDTH = 64;
export const SYNTHETIC_ATLAS_HEIGHT = 96;

/**
 * The bob ids the synthetic bindings reference. Arbitrary small integers — a synthetic atlas has no
 * `.bmd` `firstBobId`, so these only have to agree between {@link syntheticAtlasFrames} and
 * {@link SYNTHETIC_BINDINGS}. The settler gets three bobs (one per {@link SpriteState}) so the
 * per-state binding path is exercised by the `?atlas` shot.
 */
const SETTLER_IDLE_BOB = 1;
const BUILDING_BOB = 2;
const RESOURCE_BOB = 3;
const SETTLER_MOVING_BOB = 4;
const SETTLER_ACTING_BOB = 5;

/**
 * One synthetic frame: its atlas rect, its feet-anchor draw offset, and the flat fill colour the GPU
 * half paints it. Colour lives here rather than in the pure {@link AtlasFrame} because a real atlas
 * carries pixels, not a fill colour.
 */
interface SyntheticFrame {
  readonly bobId: number;
  readonly frame: AtlasFrame;
  readonly colour: string;
}

/**
 * The synthetic frames, laid out in the atlas sheet with a 1px gutter so a textured sub-rect never
 * samples a neighbour's edge. Each kind gets one marker frame offset so its bottom-centre sits at the
 * feet anchor (`offsetX = -w/2`, `offsetY = -h`), matching the placeholder geometry's feet placement.
 */
const SYNTHETIC_FRAMES: readonly SyntheticFrame[] = [
  // settler (idle)
  {
    bobId: SETTLER_IDLE_BOB,
    frame: { x: 1, y: 1, width: 12, height: 24, offsetX: -6, offsetY: -24 },
    colour: '#e8e0d0',
  },
  // building
  {
    bobId: BUILDING_BOB,
    frame: { x: 15, y: 1, width: 28, height: 40, offsetX: -14, offsetY: -40 },
    colour: '#c8a04a',
  },
  // resource
  {
    bobId: RESOURCE_BOB,
    frame: { x: 45, y: 1, width: 16, height: 28, offsetX: -8, offsetY: -28 },
    colour: '#2f7d32',
  },
  // settler (moving): tinted so a walking settler reads differently than an idle one. On the bottom
  // row (y>=42) so it clears the building/resource frames above, which reach y=41.
  {
    bobId: SETTLER_MOVING_BOB,
    frame: { x: 1, y: 42, width: 12, height: 24, offsetX: -6, offsetY: -24 },
    colour: '#7da7d9',
  },
  // settler (acting): tinted so a mid-action settler reads differently again.
  {
    bobId: SETTLER_ACTING_BOB,
    frame: { x: 15, y: 42, width: 12, height: 24, offsetX: -6, offsetY: -24 },
    colour: '#d98a52',
  },
];

/**
 * The settler's per-state binding into the synthetic atlas. No `byAtomic`: the synthetic atlas has one
 * generic action frame, not a per-atomic art set.
 */
const SYNTHETIC_SETTLER_BINDING: SettlerStateBinding = {
  idle: SETTLER_IDLE_BOB,
  moving: SETTLER_MOVING_BOB,
  acting: SETTLER_ACTING_BOB,
};

/** Per-kind binding into the synthetic atlas (the table {@link SpriteBindings} requires). */
export const SYNTHETIC_BINDINGS: SpriteBindings = {
  settler: SYNTHETIC_SETTLER_BINDING,
  building: BUILDING_BOB,
  resource: RESOURCE_BOB,
};

/**
 * The synthetic atlas frame geometry as a {@link SpriteAtlas} — the screen-free half, unit-testable
 * without a canvas. The matching texture is built by {@link createSyntheticAtlasSource}.
 */
export function syntheticAtlasFrames(): SpriteAtlas {
  const frames = new Map<number, AtlasFrame>();
  for (const f of SYNTHETIC_FRAMES) frames.set(f.bobId, f.frame);
  return { width: SYNTHETIC_ATLAS_WIDTH, height: SYNTHETIC_ATLAS_HEIGHT, frames };
}

/**
 * Draw the synthetic frames into an offscreen canvas and wrap it as a Pixi {@link TextureSource} ready
 * to bind as a {@link SpriteSheet.source}. Each frame is a flat filled rect at its atlas rect; the
 * sheet is otherwise transparent. `nearest` scaling keeps the markers crisp and cuts cross-machine
 * sampling variance, like the renderer's antialias-off.
 *
 * Takes a `document` so the same code path runs under the browser shot/dev entry; throws if a 2D
 * context can't be obtained (a programmer/environment error, not a recoverable boundary failure).
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
