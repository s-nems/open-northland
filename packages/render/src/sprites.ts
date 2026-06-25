import type { DrawItem, DrawKind, SpriteState } from './scene.js';

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
 * A settler's per-state bob ids — which atlas frame to draw for each coarse {@link SpriteState}. This
 * is the richer binding the roadmap calls for: a settler walking shows its `moving` bob, one mid-swing
 * its `acting` bob (the original keys these off `tribetypes` `setatomic`, atomic → animation). `idle`
 * is the required base; `moving`/`acting` are optional and fall back to `idle` when absent, and an
 * `acting` settler can bind a *specific* atomic id via {@link SettlerStateBinding.byAtomic} (so chop vs
 * carry pick different frames) — `acting` is the generic-action fallback when an atomic isn't listed.
 * Plain ids, not animation timing: this picks one representative frame per state, the seam the
 * vertical slice needs, not the full per-frame animation clock (a later leg).
 */
export interface SettlerStateBinding {
  /** Required base frame — used when no more-specific state frame is bound. */
  readonly idle: number;
  /** Frame while following a path. Falls back to {@link idle} when absent. */
  readonly moving?: number;
  /** Frame while executing any atomic (the generic action frame). Falls back to {@link idle}. */
  readonly acting?: number;
  /**
   * Per-atomic-id override for the `acting` state (the `setatomic` join: atomic id → its frame), so
   * e.g. chop(24) and pickup(22) draw different frames. A miss falls back to {@link acting} then
   * {@link idle}.
   */
  readonly byAtomic?: Readonly<Record<number, number>>;
}

/**
 * Which atlas bob id draws a given drawable kind. The minimal binding is one representative still
 * frame per kind (`settler` / `building` / `resource`). The settler entry may instead be a
 * {@link SettlerStateBinding} — a per-{@link SpriteState} (and per-atomic-id) table — for the richer
 * animation binding (a settler's walk/chop frames, keyed off `tribetypes` `setatomic`). A plain number
 * stays valid (back-compat: it's the idle/all-states frame), so old bindings need no change.
 */
export type SpriteBindings = Readonly<{
  settler: number | SettlerStateBinding;
  building: number;
  resource: number;
}>;

/**
 * Resolve the settler bob id for a draw item's {@link SpriteState}, given its (number | table) binding.
 * A plain number is the same frame for every state. A {@link SettlerStateBinding} picks by state with a
 * fixed fallback chain so a sparse table is always total: `acting` tries `byAtomic[id]` → `acting` →
 * `idle`; `moving` tries `moving` → `idle`; `idle` is `idle`. Pure.
 */
function settlerBobId(binding: number | SettlerStateBinding, item: DrawItem): number {
  if (typeof binding === 'number') return binding;
  const state: SpriteState = item.state ?? 'idle';
  if (state === 'acting') {
    const byAtomic = binding.byAtomic;
    if (byAtomic !== undefined && item.atomicId !== undefined) {
      const specific = byAtomic[item.atomicId];
      if (specific !== undefined) return specific;
    }
    return binding.acting ?? binding.idle;
  }
  if (state === 'moving') return binding.moving ?? binding.idle;
  return binding.idle;
}

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
 * For a settler the bob id is chosen by the item's {@link SpriteState} (and atomic id) via
 * {@link settlerBobId} — a settler walking resolves its `moving` frame, one mid-swing its `acting`
 * frame — when the binding is a {@link SettlerStateBinding}; a plain-number settler binding draws the
 * same frame regardless of state (back-compat).
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
  const binding = bindings[item.kind];
  if (binding === undefined) return null; // kind unbound -> placeholder
  const bobId = item.kind === 'settler' ? settlerBobId(binding, item) : (binding as number);
  const frame = atlas.frames.get(bobId);
  // A 0-area frame is an empty/zero-size bob — treat it as unbound so the placeholder still draws.
  if (frame === undefined || frame.width === 0 || frame.height === 0) return null;
  return frame;
}
