import type { DrawItem, DrawKind } from './scene.js';

/**
 * The PURE half of the atlas-sprite swap — the part of "draw a sprite from the bob atlas" an agent CAN
 * self-verify, kept separate from the GPU texture binding (the un-self-verifiable pixel half, deferred
 * to a human).
 *
 * Today the GPU layer ({@link import('./pixi-renderer.js').renderScene}) draws each sprite as flat
 * placeholder geometry because real bob atlases are decoded from a copyrighted game copy and gitignored
 * (see CLAUDE.md "Legal guardrails"). The remaining open render leg is to draw the actual atlas frame
 * instead. That swap has two halves:
 *  - **which atlas frame a draw item references** — a pure data lookup (`DrawItem` → frame rect), the
 *    half this module makes testable without a screen; and
 *  - **binding that rect to a GPU texture + sampling it** — pixels, which only a human can judge.
 *
 * This module is the first half: a {@link SpriteAtlas} (the manifest a `.bmd`→atlas build produces,
 * re-declared structurally here so `render` never imports the build-tool pipeline) plus a pure
 * {@link resolveSpriteFrame} that maps a drawable {@link DrawItem} to the atlas frame it should draw —
 * or `null` when nothing binds it, so the GPU layer falls back to placeholder geometry exactly as it
 * does now. No Pixi, no canvas: plain data the GPU layer will look a texture up by, once a free /
 * synthetic atlas image exists to bind.
 *
 * Floats are irrelevant here (render-only), but the frame rects are integer pixel coordinates anyway —
 * an atlas is a pixel grid.
 */

/** Atlas-frame kinds the scene binds — the drawable {@link DrawKind}s (terrain tiles bind separately). */
export type SpriteKind = Exclude<DrawKind, 'tile'>;

/**
 * One bob frame's placement in an atlas sheet, plus the draw offset to apply when placing it at a
 * sprite's feet anchor. This is the subset of the build pipeline's `AtlasFrame` a renderer needs to
 * blit one frame; re-declared here (structurally) so `render` depends only on plain data, never on the
 * build-tool that produced the atlas.
 */
export interface AtlasFrame {
  /** Pixel rect of the frame inside the atlas sheet (top-left origin). */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /**
   * The frame's source draw offset (the original's `SBobData.Area` origin). The GPU layer adds this to
   * the sprite's feet-anchor screen position so the frame sits where the bob was authored to.
   */
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * A loaded sprite atlas: the atlas sheet's pixel dimensions plus its frames indexed by bob id. The
 * shape mirrors the build pipeline's `AtlasManifest` (dimensions + per-bob frames), reduced to what the
 * renderer needs and keyed for O(1) lookup by the bob id the binding table references. The image bytes
 * themselves live on the GPU side (a texture); this is just the frame geometry.
 */
export interface SpriteAtlas {
  readonly width: number;
  readonly height: number;
  /** Frames by bob id (`bmd.firstBobId + index` from the build manifest). */
  readonly frames: ReadonlyMap<number, AtlasFrame>;
}

/**
 * Which atlas bob id draws a given drawable kind. The minimal binding for the vertical slice: one
 * representative still frame per kind (settler / building / resource). The richer per-job / per-state
 * animation binding (a settler's job → its walk/chop frames, keyed off `tribetypes` `setatomic`) is a
 * later leg — this is the seam that proves the lookup, not the full animation graph.
 */
export type SpriteBindings = Readonly<Record<SpriteKind, number>>;

/**
 * Build the bob-id → {@link AtlasFrame} map a {@link SpriteAtlas} needs from a flat manifest frame list
 * (the `{ bobId, rect, offsetX, offsetY }` records a `.bmd`→atlas build emits). Pure: a deterministic
 * fold, last-writer-wins on a duplicate bob id (the build emits one entry per id, so duplicates don't
 * occur — the guard just keeps the function total). Separated from {@link resolveSpriteFrame} so the
 * (one-time) manifest→map adaptation is testable on its own.
 */
export function indexAtlasFrames(
  width: number,
  height: number,
  manifestFrames: readonly {
    readonly bobId: number;
    readonly rect: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
    readonly offsetX: number;
    readonly offsetY: number;
  }[],
): SpriteAtlas {
  const frames = new Map<number, AtlasFrame>();
  for (const f of manifestFrames) {
    frames.set(f.bobId, {
      x: f.rect.x,
      y: f.rect.y,
      width: f.rect.width,
      height: f.rect.height,
      offsetX: f.offsetX,
      offsetY: f.offsetY,
    });
  }
  return { width, height, frames };
}

/**
 * Resolve the atlas frame a drawable {@link DrawItem} should draw, given the per-kind {@link SpriteBindings}
 * and the loaded {@link SpriteAtlas}. Returns `null` — meaning "no bound sprite, draw the placeholder" —
 * when:
 *  - the item is a terrain tile (tiles bind by landscape typeId, a separate path), or
 *  - the kind has no binding, or
 *  - the bound bob id isn't in the atlas (a missing/0×0 frame).
 *
 * Pure + total: a function of the item + the two tables only, no I/O or GPU. The GPU layer calls this
 * per draw item; a `null` keeps the current placeholder geometry, a frame is the atlas rect to blit.
 * This is the load-bearing data decision (which sprite) made self-verifiable; the un-self-verifiable
 * part (binding the rect to a texture and sampling pixels) stays on the GPU side for a human to judge.
 */
export function resolveSpriteFrame(
  item: DrawItem,
  bindings: SpriteBindings,
  atlas: SpriteAtlas,
): AtlasFrame | null {
  if (item.kind === 'tile') return null; // tiles bind by typeId, not by these per-kind bindings
  const bobId = bindings[item.kind];
  if (bobId === undefined) return null; // kind unbound -> placeholder
  const frame = atlas.frames.get(bobId);
  // A 0-area frame is an empty/zero-size bob — treat it as unbound so the placeholder still draws.
  if (frame === undefined || frame.width === 0 || frame.height === 0) return null;
  return frame;
}
