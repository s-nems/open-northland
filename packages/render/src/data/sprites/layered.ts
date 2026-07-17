import type { DrawItem } from '../scene/index.js';
import type {
  BuildingDraw,
  BuildingTypeBinding,
  ConstructionLayerRef,
  LayeredBobRef,
  ResourceTypeBinding,
  SignpostBinding,
  StockpileBinding,
} from './layered-bindings.js';

/**
 * The layered-kind resolvers: which bob id — and from which named atlas-layer family — a building /
 * resource node / stockpile draw item draws. All pure "layer *decision*" functions; binding the
 * resolved frame to a GPU texture is the renderer's half.
 */

/** Unwrap a {@link LayeredBobRef} to the generic {@link BuildingDraw} shape (bob + optional family layer). */
function unwrapBobRef(ref: LayeredBobRef): BuildingDraw {
  return typeof ref === 'number' ? { bob: ref } : { bob: ref.bob, layer: ref.layer };
}

/** A stable identity for a resolved building draw — its bob id plus its family layer (or the default layer). */
export function bobKey(draw: BuildingDraw): string {
  return `${draw.bob}:${draw.layer ?? ''}`;
}

const finishedKeyCache = new WeakMap<BuildingTypeBinding, ReadonlySet<string>>();

/**
 * The {@link bobKey} of every finished-building sprite a binding can draw (each type's completed bob plus
 * the default). The under-construction rise keeps only the stages outside this set, so a construction stage
 * that reuses another tier's finished-home bob draws only at completion. Memoized per binding (immutable
 * for the sheet's life).
 */
export function finishedBuildingBobKeys(binding: BuildingTypeBinding): ReadonlySet<string> {
  let keys = finishedKeyCache.get(binding);
  if (keys === undefined) {
    const set = new Set<string>();
    for (const ref of Object.values(binding.byType)) set.add(bobKey(unwrapBobRef(ref)));
    set.add(bobKey(unwrapBobRef(binding.default)));
    keys = set;
    finishedKeyCache.set(binding, keys);
  }
  return keys;
}

/**
 * Resolve which bob id — and from which named atlas-layer family — a building draw item draws, from its
 * (number | per-type table) binding. A plain-number binding is the same bob for every building, drawn
 * from the default building layer (no family). A {@link BuildingTypeBinding} picks `byType[item.typeId]`
 * (the building's `Building.buildingType`, the `[GfxHouse]` `LogicType`), falling back to `default` when
 * the item carries no type or the type is unmapped — so a sparse table is always total (an unknown
 * building still draws the representative house, never nothing).
 */
export function resolveBuildingDraw(binding: number | BuildingTypeBinding, item: DrawItem): BuildingDraw {
  if (typeof binding === 'number') return { bob: binding };
  const ref = (item.typeId !== undefined ? binding.byType[item.typeId] : undefined) ?? binding.default;
  return unwrapBobRef(ref);
}

/** A construction-stage draw: the stage's bob (+ family layer) and its `[fromPct, toPct]` progress
 *  window — the per-pixel reveal maps eased progress into this window as its TimeMask threshold. */
export interface ConstructionDraw extends BuildingDraw {
  readonly fromPct: number;
  readonly toPct: number;
}

/**
 * Resolve the stack of construction-stage draws an under-construction building shows, or `null` when the
 * normal body draw applies (no {@link DrawItem.builtPct}, or no construction layers bound for the type).
 * The result is every layer whose `[fromPct, toPct]` range contains the progress, in the table's stacking
 * order (the source's file order — the finished body is listed so it lands on top at high progress).
 * Ranges overlap by design, so mid-build shows several stacked stages. An empty active set (a gap in the
 * ranges) falls back to the lowest-`fromPct` layer — the earliest stage, not whatever is listed first —
 * so a site never draws as nothing.
 */
export function resolveConstructionDraws(
  binding: number | BuildingTypeBinding,
  item: DrawItem,
): ConstructionDraw[] | null {
  if (typeof binding === 'number' || item.builtPct === undefined || item.typeId === undefined) return null;
  const layers = binding.constructionByType?.[item.typeId];
  if (layers === undefined || layers.length === 0) return null;
  const pct = item.builtPct;
  const active = layers.filter((l) => pct >= l.fromPct && pct <= l.toPct);
  const chosen =
    active.length > 0
      ? active
      : [layers.reduce((lo, l) => (l.fromPct < lo.fromPct ? l : lo), layers[0] as ConstructionLayerRef)];
  return chosen.map((l) =>
    l.layer === undefined
      ? { bob: l.bob, fromPct: l.fromPct, toPct: l.toPct }
      : { bob: l.bob, layer: l.layer, fromPct: l.fromPct, toPct: l.toPct },
  );
}

/**
 * Map build progress (0..1 — `builtPct/100`, or the pool's eased display value) into a construction
 * stage's `[fromPct, toPct]` window as the 0–255 TimeMask threshold — the `time` argument of the
 * original's observed time-mask rule (a pixel draws once its `timeByte <= time`). The linear
 * window→byte mapping (start → 0, end → 255) is a named approximation because the original caller's
 * mapping is not established. A degenerate window
 * (`toPct <= fromPct`) snaps whole.
 */
export function buildTimeThreshold(progress: number, fromPct: number, toPct: number): number {
  const pct = progress * 100;
  if (toPct <= fromPct) return pct >= fromPct ? 255 : 0;
  const t = Math.min(1, Math.max(0, (pct - fromPct) / (toPct - fromPct)));
  return Math.round(t * 255);
}

/**
 * Resolve a finished building's animated state overlay — the extra sprite drawn on top of the body
 * (the `[GfxHouse]` type-4 `GfxOverlay` join: the mill's rotor) — or `null` when none applies: a
 * plain-number binding, a type with no {@link BuildingTypeBinding.overlayByType} entry, or an
 * under-construction item (`builtPct` present — the original lists overlays only for the finished
 * body). A {@link DrawItem.working} building loops the `working` spin cycle on the free `tick`
 * clock, one frame per {@link import('./bindings.js').BuildingOverlayRef.ticksPerFrame} ticks;
 * otherwise the `idle` frame draws. A state whose frames are absent draws no overlay at all (never a
 * borrowed frame).
 */
export function resolveBuildingOverlayDraw(
  binding: number | BuildingTypeBinding,
  item: DrawItem,
  tick: number,
): BuildingDraw | null {
  if (typeof binding === 'number' || item.typeId === undefined || item.builtPct !== undefined) return null;
  const overlay = binding.overlayByType?.[item.typeId];
  if (overlay === undefined) return null;
  const spin = item.working === true ? overlay.working : undefined;
  if (spin !== undefined && spin.length > 0) {
    const ticksPerFrame = Math.max(1, overlay.ticksPerFrame ?? 1);
    const bob = spin[Math.floor(tick / ticksPerFrame) % spin.length];
    if (bob === undefined) return null; // unreachable (index < length), but proven not asserted
    return overlay.layer === undefined ? { bob } : { bob, layer: overlay.layer };
  }
  if (overlay.idle === undefined) return null;
  return overlay.layer === undefined ? { bob: overlay.idle } : { bob: overlay.idle, layer: overlay.layer };
}

/**
 * Resolve which bob id — and from which named atlas-layer family — a resource draw item draws, from its
 * (number | per-good table) binding. A plain-number binding is the same node bob for every good (drawn from
 * the default resource layer); a {@link ResourceTypeBinding} picks `byGood[item.goodType]`'s per-level
 * frames (the node's `Resource.goodType`) and indexes them by the node's {@link DrawItem.level} (a mined
 * deposit's shrink-by-level fill; the frames run empty→full, so `level` = full draws the last). When the
 * item also carries {@link DrawItem.levels} and it differs from the record's own state count, the ladder is
 * rescaled onto the frames (`ceil(level·frames/levels)`) — the sim buckets every deposit into one catalog
 * level count while each `[GfxLandscape]` record authors its own (stone rocks 4 states, ore mines 5), and a
 * full deposit must draw its fullest authored frame either way. A ground drop routed through this resolver
 * (the `trunk` binding) carries a {@link DrawItem.fill} instead — the pile's unit count indexes the same
 * empty→full frames directly (the original's "state ≡ remaining units" valency read). A plain node carries
 * neither and draws the full (last) frame.
 * Falls back to `default` (the representative yew) when the item carries no good or the good is unmapped —
 * so a sparse table is always total. Returns `null` for a level whose entry is the explicit `null`
 * invisible marker (see {@link ResourceTypeBinding.byGood} — the original's freshly-sown field draws
 * nothing): the caller draws nothing at all, not the placeholder.
 */
export function resolveResourceDraw(
  binding: number | ResourceTypeBinding,
  item: DrawItem,
): BuildingDraw | null {
  if (typeof binding === 'number') return { bob: binding };
  // The node's exact source variant ("pine 02") wins over its good's representative ("yew 01") — a
  // decoded map keeps its species variety; an unbound variant (unloaded family) falls back per-good.
  const variantFrames = item.gfxIndex !== undefined ? binding.byGfxIndex?.[item.gfxIndex] : undefined;
  const frames = variantFrames ?? (item.goodType !== undefined ? binding.byGood[item.goodType] : undefined);
  if (frames === undefined || frames.length === 0) return unwrapBobRef(binding.default);
  // 1-based level (rescaled onto the record's own state count when the ladders differ) or drop fill →
  // a 0-based frame index, clamped into range; neither present falls to the full, last state.
  const ladder = item.level ?? item.fill;
  const span = item.level !== undefined && item.levels !== undefined && item.levels > 0 ? item.levels : null;
  const scaled =
    ladder === undefined
      ? frames.length
      : span !== null && span !== frames.length
        ? Math.ceil((ladder * frames.length) / span)
        : ladder;
  const idx = Math.min(frames.length, Math.max(1, scaled)) - 1;
  const ref = frames[idx];
  if (ref === null) return null; // a data-pinned invisible level — draw nothing, never the placeholder
  return unwrapBobRef(ref ?? binding.default);
}

/**
 * Resolve which bob id — and from which named atlas-layer family — a stockpile draw item draws, from its
 * (number | per-good table) binding. A plain-number binding is the same bob for every pile. A
 * {@link StockpileBinding}:
 *  - an empty pile ({@link DrawItem.goodType} absent — a bare delivery flag) draws the {@link StockpileBinding.flag};
 *  - a held pile picks its good's heap frames (`byGood[goodType]`, ordered fewest→most) and indexes them by
 *    the pile's {@link DrawItem.fill} amount, clamped into range — so the heap grows with its contents;
 *  - a held pile whose good has no bound frames falls back to {@link StockpileBinding.default}.
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
 * Resolve which bob — and from which named atlas-layer family — a signpost draw item draws: the post
 * when {@link DrawItem.boardIndex} is absent, else that angular direction-board frame (clamped into
 * the bound board list). `null` when the binding is absent (placeholder).
 */
export function resolveSignpostDraw(
  binding: SignpostBinding | undefined,
  item: DrawItem,
): BuildingDraw | null {
  if (binding === undefined) return null;
  // The owner's recolour variant when one is bound (the per-player baked atlas); else the base frames.
  const b = (item.player !== undefined ? binding.byPlayer?.[item.player] : undefined) ?? binding;
  if (item.boardIndex === undefined) return unwrapBobRef(b.post);
  const board = b.boards[Math.min(b.boards.length - 1, Math.max(0, item.boardIndex))];
  return board === undefined ? null : unwrapBobRef(board);
}
