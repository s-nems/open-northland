import type { DrawItem, DrawKind, SpriteState } from './scene.js';

/**
 * The PURE half of the atlas-sprite swap — the part of "draw a sprite from the bob atlas" an agent CAN
 * self-verify, kept separate from the GPU texture binding (the un-self-verifiable pixel half, deferred
 * to a human).
 *
 * Today the GPU layer ({@link import('../gpu/sprite-pool.js').SpritePool}) draws each sprite as flat
 * placeholder geometry because real bob atlases are decoded from a copyrighted game copy and gitignored
 * (see AGENTS.md "Legal guardrails"). The remaining open render leg is to draw the actual atlas frame
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
 * clock {@link resolveSettlerBobId} drives it by: a gait (walk) runs on the free `tick` clock (an endless
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
   * is extracted, `1` is the pinned cadence (see source basis).
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
 * the richer binding the plan calls for: a settler walking shows its `moving` bob, one mid-swing its
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
  readonly carrying?: CarryingBinding;
}

/**
 * The loaded-gait slots of a {@link SettlerStateBinding}: the generic hauling look (`idle`/`moving`)
 * plus an optional **per-good** table. The original draws a DIFFERENT carry cycle per hauled good
 * (`human_man_generic_walk_wood` for a log, `_walk_stone`, `_walk_fish`, …); {@link byGood} keys those
 * on the sim's `Carrying.goodType` ({@link DrawItem.carryGood}), so a settler hauling bread shows the
 * bread walk, one hauling stone the stone slab. A good absent from the table falls back to the generic
 * `idle`/`moving` slots (then to the un-loaded counterparts), so a sparse table is always total.
 */
export interface CarryingBinding {
  readonly idle?: SpriteFrameRef;
  readonly moving?: SpriteFrameRef;
  /** Per-`goodType` hauling look (the `..._walk_<good>` bobseq join); a miss uses the generic slots. */
  readonly byGood?: Readonly<
    Record<number, { readonly idle?: SpriteFrameRef; readonly moving?: SpriteFrameRef }>
  >;
}

/**
 * A building type's bob reference: either a plain bob id drawn from the **default** building atlas layer
 * (the single shared `ls_houses_viking.house01` layer, {@link import('../gpu/pixi-app.js').SpriteSheet.kindLayers}'s
 * `building` entry), OR a **layer-qualified** `{ layer, bob }` naming WHICH family atlas the bob comes
 * from — the multi-`.bmd` case where a building type lives in its own `.bmd`/palette (e.g. the viking HQ
 * in `ls_houses_viking4.bmd`). A `layer` keys into {@link import('../gpu/pixi-app.js').SpriteSheet.families};
 * the GPU blits the `bob` from that family's own source + frame-id space (and its per-family scale). A bare
 * number keeps the pre-multi-`.bmd` bindings valid unchanged.
 */
export type BuildingBobRef = number | { readonly layer: string; readonly bob: number };

/**
 * A resolved building draw ({@link resolveBuildingDraw}'s output): which `bob` id, and optionally which
 * named atlas-layer family it draws from. `layer === undefined` means the default building layer
 * ({@link import('../gpu/pixi-app.js').SpriteSheet.kindLayers}'s `building`); a `layer` names a
 * {@link import('../gpu/pixi-app.js').SpriteSheet.families} entry whose own atlas/source the `bob` indexes.
 */
export interface BuildingDraw {
  readonly bob: number;
  readonly layer?: string;
}

/**
 * A building's per-type bob binding — the original's `[GfxHouse]` `LogicType` → `GfxBobId` join, so
 * each building type draws ITS own house bob (a home, a well, a bakery, …) instead of one shared frame.
 * {@link byType} maps a building's `buildingType` ({@link DrawItem.typeId}) to its {@link BuildingBobRef};
 * a type absent from it falls back to {@link default} (the representative house). A plain-number ref draws
 * from the shared building atlas layer; a layer-qualified `{ layer, bob }` ref draws from a per-family
 * atlas ({@link import('../gpu/pixi-app.js').SpriteSheet.families}) — the multi-`.bmd`/per-palette case.
 */
export interface BuildingTypeBinding {
  /** Bob ref per building typeId — the `[GfxHouse]` `LogicType` → `GfxBobId` table (optionally layer-qualified). */
  readonly byType: Readonly<Record<number, BuildingBobRef>>;
  /** Bob ref for a typeId absent from {@link byType} — the fallback house (optionally layer-qualified). */
  readonly default: BuildingBobRef;
  /**
   * Construction-stage layers per building typeId — the `[GfxHouse]` `GfxBobConstructionLayer` table
   * (from-scratch rows only), each type's layers in the source's stacking (file) order. An
   * under-construction {@link DrawItem} (`builtPct` present) draws every layer whose `[fromPct, toPct]`
   * range contains its progress, stacked in list order ({@link resolveConstructionDraws}) — the grey
   * foundation alone at 0%, rising stages after. A type absent here (or a table-less binding) keeps its
   * normal finished-body draw at every progress.
   */
  readonly constructionByType?: Readonly<Record<number, readonly ConstructionLayerRef[]>>;
}

/**
 * One construction-stage layer of a building type: the bob to draw (optionally from a named atlas-layer
 * family, like {@link BuildingBobRef}) while build progress is within `[fromPct, toPct]` (inclusive).
 */
export interface ConstructionLayerRef {
  readonly bob: number;
  readonly layer?: string;
  readonly fromPct: number;
  readonly toPct: number;
}

/**
 * A bob reference that names WHICH atlas it draws from — the shape {@link BuildingBobRef} already had,
 * generalized so the per-good resource + stockpile bindings reuse the exact same family-layer mechanism
 * the buildings do: a plain bob id draws from the kind's {@link import('../gpu/pixi-app.js').SpriteSheet.kindLayers}
 * layer (the default resource atlas — the tree), a `{ layer, bob }` draws from a named
 * {@link import('../gpu/pixi-app.js').SpriteSheet.families} atlas (the rock/mine/pile/flag `.bmd`s), each
 * with its OWN frame-id space. The GPU resolves it identically for every kind ({@link BuildingDraw}).
 */
export type LayeredBobRef = number | { readonly layer: string; readonly bob: number };

/**
 * A resource node's per-good bob binding — the {@link BuildingTypeBinding} twin for harvestable objects,
 * so each good's node draws ITS own decoded `[GfxLandscape]` object (a tree for wood, a rock for stone, a
 * mine decal for iron/gold/clay, a mushroom) instead of one shared yew bob. {@link byGood} maps a node's
 * `Resource.goodType` ({@link DrawItem.goodType}) to its per-LEVEL frames, ordered **empty→full** (the
 * mine record's fill states, `state 1` first); {@link resolveResourceDraw} indexes them by the node's
 * {@link DrawItem.level} (a mined deposit's shrink-by-level fill), clamped — so a mined deposit visibly
 * shrinks, while a plain node (no level: a tree/mushroom/full deposit) draws the full (last) frame. A good
 * absent from it falls back to {@link default} (the representative yew tree). A bare-number ref draws from
 * the shared resource atlas layer (`ls_trees.tree_yew01`); a layer-qualified `{ layer, bob }` ref draws
 * from a per-`.bmd` family atlas (`ls_ground`/`ls_mushrooms` — the mine/mushroom case).
 */
export interface ResourceTypeBinding {
  /** Per-`goodType` node frames ordered EMPTY→FULL — the good→`landscapeToHarvest`-record→per-state-bob
   *  join (each optionally layer-qualified). A non-mined node has a single-frame list (drawn at any level). */
  readonly byGood: Readonly<Record<number, readonly LayeredBobRef[]>>;
  /** Bob ref for a good absent from {@link byGood} — the fallback node (the representative yew tree). */
  readonly default: LayeredBobRef;
}

/**
 * A ground pile / delivery flag's binding — the {@link ResourceTypeBinding} twin for a bare
 * `Stockpile+Position`. A HELD pile draws its good's `[GfxLandscape]` `landscapeToStore` heap
 * (`ls_goods.<good>` — a wood/stone/iron/clay/gold/mushroom pile) at a per-fill frame; an EMPTY pile
 * (a designated collection point) draws the {@link flag} sprite (`ls_temp` player sign).
 *
 * {@link byGood} maps a pile's dominant `goodType` ({@link DrawItem.goodType}) to its heap frames ordered
 * **fewest→most units**; {@link resolveStockpileDraw} indexes them by the pile's {@link DrawItem.fill}
 * amount (clamped), so the heap visibly grows. A good with no bound frames falls back to {@link default}.
 */
export interface StockpileBinding {
  /** Per-`goodType` ground-pile heap frames, ordered fewest→most units (the `landscapeToStore` join). */
  readonly byGood: Readonly<Record<number, readonly LayeredBobRef[]>>;
  /** The delivery-flag sprite drawn for an EMPTY pile (a collection point holding no goods). */
  readonly flag: LayeredBobRef;
  /** Fallback frame for a held pile whose good has no bound heap frames (drawn at any fill). */
  readonly default: LayeredBobRef;
}

/**
 * Which atlas bob id draws a given drawable kind. The minimal binding is one representative still
 * frame per kind (`settler` / `building` / `resource`). The settler entry may instead be a
 * {@link SettlerStateBinding} — a per-{@link SpriteState} (and per-atomic-id) table — for the richer
 * animation binding (a settler's walk/chop frames, keyed off `tribetypes` `setatomic`); the building
 * entry may be a {@link BuildingTypeBinding} — a per-{@link DrawItem.typeId} table — so each building
 * type draws its own house bob (the `[GfxHouse]` `LogicType` → `GfxBobId` join). A plain number stays
 * valid for either (back-compat: it's the all-types/all-states frame), so old bindings need no change.
 *
 * The `resource` entry may likewise be a {@link ResourceTypeBinding} (a per-good node table) and the
 * optional `stockpile` a {@link StockpileBinding} (per-good ground piles + a delivery flag) — the
 * gathering-economy bindings. A plain-number `resource` and an absent `stockpile` keep old sheets valid
 * (the synthetic marker sheet, older callers): a stockpile with no binding just draws the placeholder box.
 */
export type SpriteBindings = Readonly<{
  settler: number | SettlerStateBinding;
  building: number | BuildingTypeBinding;
  resource: number | ResourceTypeBinding;
  stockpile?: number | StockpileBinding;
  /** A felled tree's stump/debris binding — the {@link ResourceTypeBinding} twin for a `Stump` decor
   *  entity, drawn per-good from the dead-tree/debris atlas (`ls_trees_dead`). Reuses the resource
   *  resolver ({@link resolveResourceDraw}); absent keeps old sheets valid (stump draws the placeholder). */
  stump?: number | ResourceTypeBinding;
  /** A loose dropped-wood binding — the {@link ResourceTypeBinding} twin for a `GroundDrop` entity, the
   *  freshly-felled trunk lying on the ground (the `landscapeToPickup` stage) BEFORE a collector carries
   *  it off. Drawn per-good like the node; absent keeps old sheets valid (the drop draws the placeholder). */
  trunk?: number | ResourceTypeBinding;
}>;

/**
 * The facing used when a draw item carries none (`item.facing` is undefined — an idle/acting settler
 * with no live movement to derive a heading from). `5` is **SE** on screen (toward the camera-right) in
 * the `CR_Hum_Body` direction layout (the blocks face `0 SW, 1 W, 2 NW, 3 NE, 4 E, 5 SE, 6 S, 7 N`; see
 * source basis "Settler facing"), a toward-camera pose so a still settler faces plausibly rather than
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
 * loaded-gait override is consulted first for the `moving`/`idle` slots — the hauled good's own
 * {@link CarryingBinding.byGood} look when bound ({@link DrawItem.carryGood}), else the generic loaded
 * slots — so a hauling settler walks the loaded cycle; a *bound* atomic still wins, as a settler only
 * carries after harvesting empty-handed. The chosen {@link SpriteFrameRef} is then resolved through
 * {@link frameOf} (directional + animated when it's a {@link DirectionalAnim}). Pure. Exported so the
 * per-character render path ({@link import('../gpu/pixi-app.js').SettlerCharacter}) resolves its own
 * binding through the exact same state machine the single-binding path uses.
 */
export function resolveSettlerBobId(
  binding: number | SettlerStateBinding,
  item: DrawItem,
  tick: number,
): number {
  if (typeof binding === 'number') return binding;
  const facing = item.facing ?? DEFAULT_FACING;
  const state: SpriteState = item.state ?? 'idle';
  // Loaded-gait overrides, in effect only while the settler is hauling a good: the good's own look
  // first (the per-good `walk_<good>` join), then the generic loaded slots.
  const carrying = item.carrying ? binding.carrying : undefined;
  const byGood = item.carryGood !== undefined ? carrying?.byGood?.[item.carryGood] : undefined;
  const carry =
    carrying === undefined
      ? undefined
      : { idle: byGood?.idle ?? carrying.idle, moving: byGood?.moving ?? carrying.moving };
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
 * Resolve which bob id — and from which named atlas-layer family — a building draw item draws, from its
 * (number | per-type table) binding. A plain-number binding is the same bob for every building, drawn
 * from the default building layer (no family). A {@link BuildingTypeBinding} picks `byType[item.typeId]`
 * (the building's `Building.buildingType`, the `[GfxHouse]` `LogicType`), falling back to `default` when
 * the item carries no type or the type is unmapped — so a sparse table is always total (an unknown
 * building still draws the representative house, never nothing) — then unwraps the {@link BuildingBobRef}:
 * a plain id resolves with no `layer` (the default layer), a `{ layer, bob }` carries its family name.
 * Pure: the layer *decision*; binding the resolved frame to a GPU texture is the renderer's half.
 */
export function resolveBuildingDraw(binding: number | BuildingTypeBinding, item: DrawItem): BuildingDraw {
  if (typeof binding === 'number') return { bob: binding };
  const ref = (item.typeId !== undefined ? binding.byType[item.typeId] : undefined) ?? binding.default;
  return typeof ref === 'number' ? { bob: ref } : { bob: ref.bob, layer: ref.layer };
}

/**
 * Resolve the STACK of construction-stage draws an under-construction building shows, or `null` when
 * the normal body draw applies. Non-null only when the item is a building mid-construction
 * ({@link DrawItem.builtPct} present) whose binding carries construction layers for its type: then the
 * result is every layer whose `[fromPct, toPct]` range contains the progress, in the table's stacking
 * order (the source's file order — the finished body is listed so it lands on top at high progress).
 * At 0% that is the grey foundation alone; ranges overlap by design, so mid-build shows several stacked
 * stages, exactly the original's staged construction. An empty active set (a gap in the ranges) falls
 * back to the LOWEST-`fromPct` layer (the earliest stage — the foundation, not whatever happens to be
 * listed first) so a site never draws as nothing (the foundation marks the occupied ground from the
 * placement tick). Pure: the layer *decision*; the GPU half binds the frames.
 */
export function resolveConstructionDraws(
  binding: number | BuildingTypeBinding,
  item: DrawItem,
): BuildingDraw[] | null {
  if (typeof binding === 'number' || item.builtPct === undefined || item.typeId === undefined) return null;
  const layers = binding.constructionByType?.[item.typeId];
  if (layers === undefined || layers.length === 0) return null;
  const pct = item.builtPct;
  const active = layers.filter((l) => pct >= l.fromPct && pct <= l.toPct);
  const chosen =
    active.length > 0
      ? active
      : [layers.reduce((lo, l) => (l.fromPct < lo.fromPct ? l : lo), layers[0] as ConstructionLayerRef)];
  return chosen.map((l) => (l.layer === undefined ? { bob: l.bob } : { bob: l.bob, layer: l.layer }));
}

/** Unwrap a {@link LayeredBobRef} to the generic {@link BuildingDraw} shape (bob + optional family layer). */
export function unwrapBobRef(ref: LayeredBobRef): BuildingDraw {
  return typeof ref === 'number' ? { bob: ref } : { bob: ref.bob, layer: ref.layer };
}

/**
 * Resolve which bob id — and from which named atlas-layer family — a RESOURCE draw item draws, from its
 * (number | per-good table) binding. The {@link ResourceTypeBinding} twin of {@link resolveBuildingDraw}:
 * a plain-number binding is the same node bob for every good (drawn from the default resource layer); a
 * {@link ResourceTypeBinding} picks `byGood[item.goodType]`'s per-level frames (the node's
 * `Resource.goodType`) and indexes them by the node's {@link DrawItem.level} (a mined deposit's
 * shrink-by-level fill; the frames run empty→full, so `level` = full draws the last). A plain node carries
 * no `level` and draws the FULL (last) frame — so a tree/mushroom/stump/trunk/full deposit is unaffected.
 * Falls back to `default` (the representative yew) when the item carries no good or the good is unmapped —
 * so a sparse table is always total. Pure: the layer *decision*; the GPU half binds the frame.
 */
export function resolveResourceDraw(binding: number | ResourceTypeBinding, item: DrawItem): BuildingDraw {
  if (typeof binding === 'number') return { bob: binding };
  const frames = item.goodType !== undefined ? binding.byGood[item.goodType] : undefined;
  if (frames === undefined || frames.length === 0) return unwrapBobRef(binding.default);
  // A mined node's 1-based fill LEVEL (`levels` = full) → a 0-based frame index, clamped into range; a
  // plain node carries no level and falls to `frames.length` (the full, last state) — full-node behaviour.
  const idx = Math.min(frames.length, Math.max(1, item.level ?? frames.length)) - 1;
  return unwrapBobRef(frames[idx] ?? binding.default);
}

/**
 * Resolve which bob id — and from which named atlas-layer family — a STOCKPILE draw item draws, from its
 * (number | per-good table) binding. A plain-number binding is the same bob for every pile. A
 * {@link StockpileBinding}:
 *  - an EMPTY pile ({@link DrawItem.goodType} absent — a bare delivery flag) draws the {@link StockpileBinding.flag};
 *  - a HELD pile picks its good's heap frames (`byGood[goodType]`, ordered fewest→most) and indexes them by
 *    the pile's {@link DrawItem.fill} amount, clamped into range — so the heap grows with its contents;
 *  - a held pile whose good has no bound frames falls back to {@link StockpileBinding.default}.
 * Pure: the layer *decision*; the GPU half binds the frame.
 */
export function resolveStockpileDraw(binding: number | StockpileBinding, item: DrawItem): BuildingDraw {
  if (typeof binding === 'number') return { bob: binding };
  if (item.goodType === undefined) return unwrapBobRef(binding.flag); // empty pile → the delivery flag
  const frames = binding.byGood[item.goodType];
  if (frames === undefined || frames.length === 0) return unwrapBobRef(binding.default);
  // 1-based fill amount → a 0-based frame index, clamped to the heap's available fill states.
  const idx = Math.min(frames.length, Math.max(1, item.fill ?? 1)) - 1;
  return unwrapBobRef(frames[idx] ?? binding.default);
}

/**
 * Resolve the ordered layer refs for a stockpile. A filled delivery flag draws its heap first and the
 * flag second, so the flag stays visible on top of the gathered goods. The GPU layer binds these refs to
 * real atlas layers; this pure helper pins the draw order without needing Pixi in tests.
 */
export function resolveStockpileLayerDraws(
  binding: number | StockpileBinding,
  item: DrawItem,
): BuildingDraw[] {
  if (typeof binding === 'number') return [{ bob: binding }];
  const primary = resolveStockpileDraw(binding, item);
  if (item.goodType === undefined) return [primary];
  return [primary, unwrapBobRef(binding.flag)];
}

/**
 * Resolve the atlas bob id a drawable {@link DrawItem} should draw — the frame *selection* alone (no
 * atlas lookup), so the GPU layer can draw the **same** id from several layered atlases (body + head)
 * without re-deciding per layer. Returns `null` for a terrain tile or an unbound kind. A settler's id
 * is chosen by state + facing + `tick` via {@link resolveSettlerBobId} (animated/directional when the binding
 * is a {@link DirectionalAnim}); a building's by its `typeId` via {@link resolveBuildingDraw} (its own
 * house bob when the binding is a {@link BuildingTypeBinding}); a resource by its `goodType` via
 * {@link resolveResourceDraw} (its own species/deposit node); a stockpile by its good + fill via
 * {@link resolveStockpileDraw} (a per-good pile, or the flag when empty). Pure.
 */
export function resolveSpriteBobId(item: DrawItem, bindings: SpriteBindings, tick = 0): number | null {
  if (item.kind === 'tile') return null; // tiles bind by typeId, not these per-kind bindings
  // A ground drop (freshly-felled trunk) draws its per-good pickup-stage frame from the `trunk` binding via
  // the SAME per-good resolver a node uses; the DrawKind ('grounddrop', the entity) and binding key ('trunk',
  // the graphic) differ, so it is resolved explicitly rather than through the generic `bindings[kind]` lookup.
  if (item.kind === 'grounddrop')
    return bindings.trunk === undefined ? null : resolveResourceDraw(bindings.trunk, item).bob;
  const binding = bindings[item.kind];
  if (binding === undefined) return null; // kind unbound -> placeholder
  if (item.kind === 'settler')
    return resolveSettlerBobId(binding as number | SettlerStateBinding, item, tick);
  if (item.kind === 'building') return resolveBuildingDraw(binding as number | BuildingTypeBinding, item).bob;
  if (item.kind === 'resource') return resolveResourceDraw(binding as number | ResourceTypeBinding, item).bob;
  // A stump reuses the per-good resource resolver — it draws its debris frame the same way a node draws
  // its species, just from the dead-tree atlas its binding names.
  if (item.kind === 'stump') return resolveResourceDraw(binding as number | ResourceTypeBinding, item).bob;
  return resolveStockpileDraw(binding as number | StockpileBinding, item).bob; // stockpile
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
 * {@link import('../gpu/synthetic-atlas.js').syntheticAtlasFrames} for the synthetic one. The matching atlas
 * *image* is loaded separately on the GPU side ({@link import('../gpu/pixi-app.js').loadAtlasSource}).
 */
export function atlasFromManifest(manifest: AtlasManifest): SpriteAtlas {
  return indexAtlasFrames(manifest.width, manifest.height, manifest.frames);
}

/**
 * A job-keyed lookup with a **young** (age-class) side table and a total fallback — the shape the
 * per-character settler binding uses ({@link import('../gpu/pixi-app.js').SettlerCharacterSet}), kept
 * generic + pure here so the pick is unit-testable without GPU layers.
 *
 * Why two tables: the original's age classes reuse LOW `jobtypes` ids (1..4 = baby/child), and a
 * synthetic fixture's adult job ids can collide with them (the demo woodcutter is jobType 1 — the real
 * `baby_female` id; see AGENTS.md [dc3ef54]). The sim disambiguates by the `Age` component (only a
 * born-young settler carries one), so the pick does too: a **young** item keys
 * {@link ByJobTable.youngByJob}, an adult keys {@link ByJobTable.byJob}, and any miss (including a
 * `null`-job idle adult) lands on {@link ByJobTable.default} — a fixture's adult "jobType 1" can never
 * draw the baby body.
 */
export interface ByJobTable<T> {
  /** Adult looks by `jobType` (e.g. woman 5, the soldier family 31..41). */
  readonly byJob: Readonly<Record<number, T>>;
  /** Looks for an `Age`-carrying (born-young) settler, keyed by its age-class `jobType` (1..4). */
  readonly youngByJob?: Readonly<Record<number, T>>;
  /** The total fallback — the generic look every unmapped job resolves to. */
  readonly default: T;
}

/**
 * Pick from a {@link ByJobTable} for a draw item's `jobType` + young flag: young → {@link ByJobTable.youngByJob},
 * adult → {@link ByJobTable.byJob}, any miss → {@link ByJobTable.default}. Pure + total.
 */
export function pickByJob<T>(table: ByJobTable<T>, jobType: number | undefined, young: boolean): T {
  if (jobType === undefined) return table.default;
  const hit = young ? table.youngByJob?.[jobType] : table.byJob[jobType];
  return hit ?? table.default;
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
 * {@link resolveSettlerBobId} — a settler walking resolves its `moving` frame, one mid-swing its `acting`
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
