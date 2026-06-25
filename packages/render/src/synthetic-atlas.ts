import { CanvasSource, type TextureSource } from 'pixi.js';
import type { AtlasFrame, SpriteAtlas, SpriteBindings } from './sprites.js';

/**
 * A FREE, SYNTHETIC sprite atlas — the texture to bind so the atlas-sprite draw path (the textured
 * sub-rect branch of {@link import('./pixi-renderer.js').renderScene}) is actually exercised end to
 * end, *without* any copyrighted game data.
 *
 * Real bob atlases are decoded from an owned game copy and gitignored (see CLAUDE.md "Legal
 * guardrails"), so they can't be the default texture in a committed, reproducible harness. This module
 * stands in a tiny hand-authored atlas instead: a few flat coloured marker frames (one per drawable
 * {@link import('./sprites.js').SpriteKind}) drawn procedurally into a canvas. It is NOT art — it's a
 * proof-of-wiring placeholder that lets a human eyeball that *the textured branch* projects + depth-
 * sorts correctly (frames land at their feet anchor, occlude back-to-front), the one render property
 * that needs an eye. When real bob atlases exist, the same {@link SpriteSheet} shape binds them with
 * no renderer change.
 *
 * The split mirrors `sprites.ts`: the *frame geometry* ({@link syntheticAtlasFrames}) is pure data,
 * unit-testable without a screen; drawing those frames into a GPU {@link TextureSource}
 * ({@link createSyntheticAtlasSource}) is the pixel half, deferred to a human eye. Floats/ints here are
 * render-only — an atlas is a pixel grid, never read back into the deterministic sim.
 */

/** The synthetic atlas sheet dimensions (a small power-of-two-ish grid; pure layout, no art). */
export const SYNTHETIC_ATLAS_WIDTH = 64;
export const SYNTHETIC_ATLAS_HEIGHT = 64;

/**
 * The bob ids the synthetic bindings reference. Arbitrary small integers — a synthetic atlas has no
 * `.bmd` `firstBobId`, so these just have to agree between {@link syntheticAtlasFrames} and
 * {@link SYNTHETIC_BINDINGS}.
 */
const SETTLER_BOB = 1;
const BUILDING_BOB = 2;
const RESOURCE_BOB = 3;

/**
 * One synthetic frame: its atlas rect, its feet-anchor draw offset, and the flat fill colour the GPU
 * half paints it. Colour lives here (not in the pure {@link AtlasFrame}) because it's only the synthetic
 * texture's business — a real atlas carries pixels, not a fill colour.
 */
interface SyntheticFrame {
  readonly bobId: number;
  readonly frame: AtlasFrame;
  readonly colour: string;
}

/**
 * The synthetic frames, laid out in the atlas sheet with a 1px gutter (so a textured sub-rect never
 * samples a neighbour's edge). Each kind gets one marker frame, sized + offset like a feet-anchored
 * sprite (the offset places the frame so its bottom-centre sits at the feet anchor — `offsetX = -w/2`,
 * `offsetY = -h`), so the textured branch reproduces the same feet placement the placeholder geometry
 * uses. Pure data — no canvas, no GPU.
 */
const SYNTHETIC_FRAMES: readonly SyntheticFrame[] = [
  // settler: a tall thin figure, 12x24.
  {
    bobId: SETTLER_BOB,
    frame: { x: 1, y: 1, width: 12, height: 24, offsetX: -6, offsetY: -24 },
    colour: '#e8e0d0',
  },
  // building: a wide box, 28x40.
  {
    bobId: BUILDING_BOB,
    frame: { x: 15, y: 1, width: 28, height: 40, offsetX: -14, offsetY: -40 },
    colour: '#c8a04a',
  },
  // resource: a small tree-ish block, 16x28.
  {
    bobId: RESOURCE_BOB,
    frame: { x: 45, y: 1, width: 16, height: 28, offsetX: -8, offsetY: -28 },
    colour: '#2f7d32',
  },
];

/** Per-kind binding into the synthetic atlas (the table {@link SpriteBindings} requires). */
export const SYNTHETIC_BINDINGS: SpriteBindings = {
  settler: SETTLER_BOB,
  building: BUILDING_BOB,
  resource: RESOURCE_BOB,
};

/**
 * The synthetic atlas frame geometry as a {@link SpriteAtlas} — pure, deterministic, screen-free. This
 * is the self-verifiable half: it can be unit-tested (every bound bob id resolves to an in-bounds,
 * non-empty frame) without a canvas. The matching texture is built by {@link createSyntheticAtlasSource}.
 */
export function syntheticAtlasFrames(): SpriteAtlas {
  const frames = new Map<number, AtlasFrame>();
  for (const f of SYNTHETIC_FRAMES) frames.set(f.bobId, f.frame);
  return { width: SYNTHETIC_ATLAS_WIDTH, height: SYNTHETIC_ATLAS_HEIGHT, frames };
}

/**
 * Draw the synthetic frames into an offscreen canvas and wrap it as a Pixi {@link TextureSource} ready
 * to bind as a {@link SpriteSheet.source}. This is the PIXEL half — its output only a human can judge
 * (does the textured sprite land where the bob would?). Each frame is a flat filled rect at its atlas
 * rect; the sheet is otherwise transparent. `nearest` scaling keeps the synthetic markers crisp (and
 * cuts cross-machine sampling variance, like the renderer's antialias-off).
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
