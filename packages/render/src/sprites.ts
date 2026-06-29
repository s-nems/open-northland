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
 * A directional, time-animated bob sequence — the original's `[bobseq]` layout: `dirs` facing
 * directions laid out back-to-back, each `stride` frames long, starting at bob id {@link start}. The
 * frame to draw is `start + facing*stride + (floor(clock / ticksPerFrame) % cycle)`, where `cycle` is
 * {@link frames} (default {@link stride}) — so a settler plays its walk/chop cycle *for the way it
 * faces*, advancing one frame every {@link ticksPerFrame} sim ticks. The cadence is **locked to game
 * ticks, never stretched to fit an action's duration** — that is what keeps every swing the SAME speed
 * (the original's behavior): a 15-tick chop and a 4-tick deposit advance frames at the identical rate.
 * Set `frames: 1` to hold a single still pose per direction (e.g. a standing idle that still turns to
 * face its heading). The facing index comes from {@link DrawItem.facing} (else {@link DEFAULT_FACING}).
 *
 * Whether the sequence loops forever or plays once is **not a property of the animation** — it is which
 * clock {@link settlerBobId} drives it by: a gait (walk) runs on the free `tick` clock (an endless
 * loop), an action (chop) runs on the atomic's own `elapsed` clock and, because the action's `duration`
 * is tuned to a whole number of cycles, plays exactly that many full swings and ends as the action
 * completes — no mid-swing cutoff, no speed that changes with the action length.
 */
export interface DirectionalAnim {
  /** Bob id of direction 0, frame 0 — the sequence's first frame (`startFrame` in `animations.ini`). */
  readonly start: number;
  /** Number of facing directions laid out back-to-back (Cultures humans use 8). */
  readonly dirs: number;
  /** Frames per direction in the source layout — the stride between one direction and the next. */
  readonly stride: number;
  /** Frames to actually cycle through (default {@link stride}); `1` holds a single pose per direction. */
  readonly frames?: number;
  /**
   * Sim ticks per animation frame — the fixed cadence the sequence advances at (default `1`, one frame
   * per tick). Larger values play the sequence slower (a frame is held for several ticks) while keeping
   * it tick-locked and constant-speed. The original's per-`bobseq` frame duration maps here; until it
   * is extracted, `1` is the pinned cadence (see docs/FIDELITY.md).
   */
  readonly ticksPerFrame?: number;
  /**
   * Frame index within the cycle to START on (default `0`) — the sequence plays
   * `(phaseStart + step) % cycle`. A `[bobseq]` is a CONTINUOUS loop with no inherent first frame, so
   * this rotates where playback begins, letting an action begin and end on meaningful poses. The chop's
   * 15-frame loop is `0..8` = the axe coming DOWN to the tree (the strike) and `9..14` = the axe rising
   * (the windup); `phaseStart: 9` plays windup→strike (9..14, 0..8) so a single chop *starts* by winding
   * up and *ends* on the impact (frame 8). A gait (walk) starts at 0.
   */
  readonly phaseStart?: number;
}

/** A frame reference in a settler binding: a fixed bob id, or a {@link DirectionalAnim} sequence. */
export type SpriteFrameRef = number | DirectionalAnim;

/**
 * A settler's per-state frames — which atlas bob to draw for each coarse {@link SpriteState}. This is
 * the richer binding the roadmap calls for: a settler walking shows its `moving` bob, one mid-swing its
 * `acting` bob (the original keys these off `tribetypes` `setatomic`, atomic → animation). `idle` is
 * the required base; `moving`/`acting` are optional and fall back to `idle` when absent, and an
 * `acting` settler can bind a *specific* atomic id via {@link SettlerStateBinding.byAtomic} (so chop vs
 * carry pick different frames) — `acting` is the generic-action fallback when an atomic isn't listed.
 *
 * Each slot is a {@link SpriteFrameRef}: a plain bob id (one still frame for every facing/tick) **or** a
 * {@link DirectionalAnim} (a per-facing, per-tick animated sequence). A bare id stays valid, so the
 * earlier single-frame bindings need no change.
 */
export interface SettlerStateBinding {
  /** Required base frame — used when no more-specific state frame is bound. */
  readonly idle: SpriteFrameRef;
  /** Frame(s) while following a path. Falls back to {@link idle} when absent. */
  readonly moving?: SpriteFrameRef;
  /** Frame(s) while executing any atomic (the generic action). Falls back to {@link idle}. */
  readonly acting?: SpriteFrameRef;
  /**
   * Per-atomic-id override for the `acting` state (the `setatomic` join: atomic id → its frame(s)), so
   * e.g. chop(24) and pickup(22) draw different animations. A miss falls back to {@link acting} then
   * {@link idle}.
   */
  readonly byAtomic?: Readonly<Record<number, SpriteFrameRef>>;
  /**
   * Loaded-gait override, in effect only while the draw item is hauling a good ({@link DrawItem.carrying}).
   * A carrier swaps its empty-handed walk/stand for these (the original's `..._walk_wood` bobseq vs the
   * plain `..._walk`): `moving` while walking a load home, `idle` while standing or depositing it. Each
   * slot falls back to its un-loaded counterpart when absent, so a binding that omits `carrying` is
   * unchanged — and a *bound* atomic animation (e.g. the chop in {@link byAtomic}) still wins, since a
   * settler only carries *after* it has finished harvesting empty-handed.
   */
  readonly carrying?: {
    readonly idle?: SpriteFrameRef;
    readonly moving?: SpriteFrameRef;
  };
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
 * The facing used when a draw item carries none (`item.facing` is undefined — an idle/acting settler
 * with no live movement to derive a heading from). `5` is **SE** on screen (toward the camera-right) in
 * the `CR_Hum_Body` direction layout (the blocks face `0 SW, 1 W, 2 NW, 3 NE, 4 E, 5 SE, 6 S, 7 N`; see
 * docs/FIDELITY.md "Settler facing"), a toward-camera pose so a still settler faces plausibly rather than
 * snapping to a back/profile view. Per-entity "hold the last heading" is a later refinement.
 */
export const DEFAULT_FACING = 5;

/** Non-negative modulo (JS `%` keeps the sign), so a negative facing/tick still indexes in range. */
function wrap(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/**
 * Resolve a {@link SpriteFrameRef} to a concrete bob id for a given facing and animation `clock` (an
 * integer tick count — the free sim tick for a looping gait, or the atomic's `elapsed` for an action).
 * A plain number is that id verbatim. A {@link DirectionalAnim} indexes its layout
 * `start + facing*stride + phase`, where `step = floor(clock / ticksPerFrame)` and
 * `phase = (phaseStart + step) % cycle`, with `cycle = frames ?? stride`. The phase is a pure function
 * of the clock, so the cadence is fixed: the sequence advances one frame every `ticksPerFrame` ticks
 * regardless of how long any action lasts — never stretched to fit a duration. {@link DirectionalAnim.phaseStart}
 * rotates where the loop begins (so an action can start on its windup and end on its impact).
 * `cycle <= 0` pins the first frame. Pure.
 */
function frameOf(ref: SpriteFrameRef, facing: number, clock: number): number {
  if (typeof ref === 'number') return ref;
  const dir = wrap(facing, ref.dirs);
  const cycle = ref.frames ?? ref.stride;
  if (cycle <= 0) return ref.start + dir * ref.stride;
  const ticksPerFrame = Math.max(1, ref.ticksPerFrame ?? 1);
  const step = Math.floor(clock / ticksPerFrame);
  const phase = wrap((ref.phaseStart ?? 0) + step, cycle);
  return ref.start + dir * ref.stride + phase;
}

/**
 * Resolve the settler bob id for a draw item's {@link SpriteState} + facing + tick, given its
 * (number | table) binding. A plain number is the same frame for every state. A
 * {@link SettlerStateBinding} picks by state with a fixed fallback chain so a sparse table is always
 * total: `acting` tries `byAtomic[id]` → `acting` → `idle`; `moving` tries `moving` → `idle`; `idle` is
 * `idle`. When the item is {@link DrawItem.carrying} a good, the {@link SettlerStateBinding.carrying}
 * loaded-gait override is consulted first for the `moving`/`idle` slots (so a hauling settler walks the
 * loaded cycle); a *bound* atomic still wins, as a settler only carries after harvesting empty-handed.
 * The chosen {@link SpriteFrameRef} is then resolved through {@link frameOf} (directional + animated
 * when it's a {@link DirectionalAnim}). Pure.
 */
function settlerBobId(binding: number | SettlerStateBinding, item: DrawItem, tick: number): number {
  if (typeof binding === 'number') return binding;
  const facing = item.facing ?? DEFAULT_FACING;
  const state: SpriteState = item.state ?? 'idle';
  // Loaded-gait overrides, in effect only while the settler is hauling a good.
  const carry = item.carrying ? binding.carrying : undefined;
  if (state === 'acting') {
    // An action animation runs on the atomic's OWN clock: `elapsed` ticks since the action started
    // (0-based, so frame 0 shows on its first tick). Frames advance at the binding's fixed cadence, so
    // the swing is the same speed for every action — a 4-tick deposit and a 15-tick chop step frames
    // identically; a chop simply has more ticks, so the full swing plays. This is the tick-locked
    // cadence the original uses, replacing the old progress-stretch that made speed vary with duration.
    const clock = Math.max(0, (item.elapsed ?? 1) - 1);
    const byAtomic = binding.byAtomic;
    if (byAtomic !== undefined && item.atomicId !== undefined) {
      const specific = byAtomic[item.atomicId];
      if (specific !== undefined) return frameOf(specific, facing, clock);
    }
    // No animation bound for this atomic → a still pose: the loaded stand while hauling (the deposit),
    // else the generic acting/idle. A deposit/pickup has no decoded swing; standing is faithful-enough
    // and never borrows the woodcut swing at a wrong speed.
    return frameOf(carry?.idle ?? binding.acting ?? binding.idle, facing, clock);
  }
  if (state === 'moving') return frameOf(carry?.moving ?? binding.moving ?? binding.idle, facing, tick);
  return frameOf(carry?.idle ?? binding.idle, facing, tick);
}

/**
 * Resolve the atlas bob id a drawable {@link DrawItem} should draw — the frame *selection* alone (no
 * atlas lookup), so the GPU layer can draw the **same** id from several layered atlases (body + head)
 * without re-deciding per layer. Returns `null` for a terrain tile or an unbound kind. For a settler
 * the id is chosen by state + facing + `tick` via {@link settlerBobId} (animated/directional when the
 * binding is a {@link DirectionalAnim}); other kinds use their plain bound id. Pure.
 */
export function resolveSpriteBobId(item: DrawItem, bindings: SpriteBindings, tick = 0): number | null {
  if (item.kind === 'tile') return null; // tiles bind by typeId, not these per-kind bindings
  const binding = bindings[item.kind];
  if (binding === undefined) return null; // kind unbound -> placeholder
  return item.kind === 'settler' ? settlerBobId(binding, item, tick) : (binding as number);
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
 * One frame record in the on-disk `.bmd`→atlas manifest (`<name>.atlas.json`) the pipeline emits.
 * It carries more than the renderer needs (`type`/`opaque` describe the source bob, not its placement);
 * {@link atlasFromManifest} keeps only the rect + draw offset {@link indexAtlasFrames} indexes by.
 */
export interface AtlasManifestFrame {
  readonly bobId: number;
  readonly rect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * The on-disk atlas manifest shape — the JSON a `.bmd`→atlas build writes alongside the atlas PNG
 * (`{ width, height, frames }`). Mirrors the pipeline's `AtlasManifest`; re-declared structurally here
 * so `render` parses a decoded manifest into its in-memory {@link SpriteAtlas} without importing the
 * build tool (the same one-way "plain data only" boundary the rest of this module keeps).
 */
export interface AtlasManifest {
  readonly width: number;
  readonly height: number;
  readonly frames: readonly AtlasManifestFrame[];
}

/**
 * Adapt a decoded {@link AtlasManifest} (parsed from a `<name>.atlas.json`) into the in-memory
 * {@link SpriteAtlas} the GPU layer looks frames up in. A thin pure wrapper over {@link indexAtlasFrames}
 * — the seam where a real, decoded bob atlas enters the renderer, the analogue of
 * {@link import('./synthetic-atlas.js').syntheticAtlasFrames} for the synthetic one. The matching atlas
 * *image* is loaded separately on the GPU side ({@link import('./pixi-renderer.js').loadAtlasSource}).
 */
export function atlasFromManifest(manifest: AtlasManifest): SpriteAtlas {
  return indexAtlasFrames(manifest.width, manifest.height, manifest.frames);
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
  tick = 0,
): AtlasFrame | null {
  const bobId = resolveSpriteBobId(item, bindings, tick);
  if (bobId === null) return null;
  const frame = atlas.frames.get(bobId);
  // A 0-area frame is an empty/zero-size bob — treat it as unbound so the placeholder still draws.
  if (frame === undefined || frame.width === 0 || frame.height === 0) return null;
  return frame;
}
