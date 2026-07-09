import type { DrawItem } from '../scene/index.js';
import type {
  BuildingDraw,
  BuildingTypeBinding,
  ConstructionLayerRef,
  LayeredBobRef,
  ResourceTypeBinding,
  StockpileBinding,
} from './bindings.js';

/**
 * The layered-kind resolvers: which bob id — and from which named atlas-layer family — a building /
 * resource node / stockpile draw item draws. All pure "layer *decision*" functions; binding the
 * resolved frame to a GPU texture is the renderer's half.
 */

/** Unwrap a {@link LayeredBobRef} to the generic {@link BuildingDraw} shape (bob + optional family layer). */
export function unwrapBobRef(ref: LayeredBobRef): BuildingDraw {
  return typeof ref === 'number' ? { bob: ref } : { bob: ref.bob, layer: ref.layer };
}

/**
 * Resolve which bob id — and from which named atlas-layer family — a building draw item draws, from its
 * (number | per-type table) binding. A plain-number binding is the same bob for every building, drawn
 * from the default building layer (no family). A {@link BuildingTypeBinding} picks `byType[item.typeId]`
 * (the building's `Building.buildingType`, the `[GfxHouse]` `LogicType`), falling back to `default` when
 * the item carries no type or the type is unmapped — so a sparse table is always total (an unknown
 * building still draws the representative house, never nothing) — then unwraps the
 * {@link import('./bindings.js').BuildingBobRef}: a plain id resolves with no `layer` (the default
 * layer), a `{ layer, bob }` carries its family name.
 */
export function resolveBuildingDraw(binding: number | BuildingTypeBinding, item: DrawItem): BuildingDraw {
  if (typeof binding === 'number') return { bob: binding };
  const ref = (item.typeId !== undefined ? binding.byType[item.typeId] : undefined) ?? binding.default;
  return unwrapBobRef(ref);
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
 * placement tick).
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

/**
 * Resolve which bob id — and from which named atlas-layer family — a RESOURCE draw item draws, from its
 * (number | per-good table) binding. The {@link ResourceTypeBinding} twin of {@link resolveBuildingDraw}:
 * a plain-number binding is the same node bob for every good (drawn from the default resource layer); a
 * {@link ResourceTypeBinding} picks `byGood[item.goodType]`'s per-level frames (the node's
 * `Resource.goodType`) and indexes them by the node's {@link DrawItem.level} (a mined deposit's
 * shrink-by-level fill; the frames run empty→full, so `level` = full draws the last). A plain node carries
 * no `level` and draws the FULL (last) frame — so a tree/mushroom/stump/trunk/full deposit is unaffected.
 * Falls back to `default` (the representative yew) when the item carries no good or the good is unmapped —
 * so a sparse table is always total.
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
 * Resolve the ordered layer refs for a stockpile. A pile draws exactly its own graphic: a FILLED loose pile
 * draws its per-fill heap alone (the heap grows with its contents — a hand-dropped or gathered pile of goods
 * resting on the ground), while an EMPTY pile draws the flag marker (a designated collection point with
 * nothing in it yet). The GPU layer binds these refs to real atlas layers; this pure helper pins the draw
 * order without needing Pixi in tests.
 *
 * NOTE: a future "designated collection point keeps its flag visible ABOVE accumulated goods" needs its own
 * marker component to re-add the flag layer — today the only filled bare stockpiles are loose good piles,
 * which must read as their heap alone (no flag planted through them), so the flag is the empty-point marker.
 */
export function resolveStockpileLayerDraws(
  binding: number | StockpileBinding,
  item: DrawItem,
): BuildingDraw[] {
  if (typeof binding === 'number') return [{ bob: binding }];
  // resolveStockpileDraw already returns the heap for a held good and the flag for an empty pile.
  return [resolveStockpileDraw(binding, item)];
}
