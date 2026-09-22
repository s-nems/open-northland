import type { DrawItem } from '../scene/index.js';
import type {
  BuildingDraw,
  BuildingTribeTables,
  BuildingTypeBinding,
  ConstructionLayerRef,
  CraftFxBinding,
  LayeredBobRef,
  ResourceTypeBinding,
  SignpostBinding,
  StockpileBinding,
} from './layered-bindings.js';
import { waveFrameAt } from './wave-loop.js';

function unwrapBobRef(ref: LayeredBobRef): BuildingDraw {
  return typeof ref === 'number' ? { bob: ref } : { bob: ref.bob, layer: ref.layer };
}

export function bobKey(draw: BuildingDraw): string {
  return `${draw.bob}:${draw.layer ?? ''}`;
}

/** 1-based count to 0-based index, clamped into `[0, frameCount - 1]`. */
function fillFrameIndex(fillOneBased: number, frameCount: number): number {
  return Math.min(frameCount, Math.max(1, fillOneBased)) - 1;
}

const finishedKeyCache = new WeakMap<BuildingTypeBinding, ReadonlySet<string>>();

/**
 * Every finished-building sprite a binding can draw, across every tribe skin, so the crop-path
 * construction rise can drop a stage that reuses another tier's finished-home bob. Memoized per
 * binding, which is immutable for the sheet's life.
 */
export function finishedBuildingBobKeys(binding: BuildingTypeBinding): ReadonlySet<string> {
  let keys = finishedKeyCache.get(binding);
  if (keys === undefined) {
    const set = new Set<string>();
    for (const tables of [binding, ...Object.values(binding.byTribe ?? {})]) {
      for (const ref of Object.values(tables.byType)) set.add(bobKey(unwrapBobRef(ref)));
    }
    set.add(bobKey(unwrapBobRef(binding.default)));
    keys = set;
    finishedKeyCache.set(binding, keys);
  }
  return keys;
}

/** The item's tribe skin, or the base tables for an item of no or an unloaded tribe. */
function tablesFor(binding: BuildingTypeBinding, item: DrawItem): BuildingTribeTables {
  return (item.tribe !== undefined ? binding.byTribe?.[item.tribe] : undefined) ?? binding;
}

/** The per-type table read: the tribe's own row, else the base tribe's, else `undefined`. */
function byTypeFor<T>(
  binding: BuildingTypeBinding,
  item: DrawItem,
  table: (tables: BuildingTribeTables) => Readonly<Record<number, T>> | undefined,
): T | undefined {
  if (item.typeId === undefined) return undefined;
  return table(tablesFor(binding, item))?.[item.typeId] ?? table(binding)?.[item.typeId];
}

/** An unmapped or type-less item falls back to `default`, so a sparse table is always total. */
export function resolveBuildingDraw(binding: number | BuildingTypeBinding, item: DrawItem): BuildingDraw {
  if (typeof binding === 'number') return { bob: binding };
  return unwrapBobRef(byTypeFor(binding, item, (t) => t.byType) ?? binding.default);
}

export interface ConstructionDraw extends BuildingDraw {
  readonly fromPct: number;
  readonly toPct: number;
}

/**
 * The stage stack an under-construction building shows, or `null` when the normal body draw applies. A
 * layer stays drawn until every layer stacked above it has finished revealing, so a scaffold persists
 * under the body covering it, and the stack is never empty. The windows are extracted; the
 * persist-until-covered handoff is a named approximation of the original's scaffold teardown.
 */
export function resolveConstructionDraws(
  binding: number | BuildingTypeBinding,
  item: DrawItem,
): ConstructionDraw[] | null {
  if (typeof binding === 'number' || item.builtPct === undefined || item.typeId === undefined) return null;
  const layers = byTypeFor(binding, item, (t) => t.constructionByType);
  if (layers === undefined || layers.length === 0) return null;
  const pct = item.builtPct;
  // Descending index is drawn-on-top first, so `coverTo` accumulates the max `toPct` above each layer.
  const active: ConstructionLayerRef[] = [];
  let coverTo = 0;
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (l === undefined) continue;
    coverTo = Math.max(coverTo, l.toPct);
    if (pct >= l.fromPct && pct <= coverTo) active.unshift(l);
  }
  const chosen =
    active.length > 0
      ? active
      : [layers.reduce((lo, l) => (l.fromPct < lo.fromPct ? l : lo), layers[0] as ConstructionLayerRef)];
  return chosen.map(stageDraw);
}

/** The `exactOptionalPropertyTypes` split on `layer` that both stage resolvers share. */
function stageDraw(l: ConstructionLayerRef): ConstructionDraw {
  return l.layer === undefined
    ? { bob: l.bob, fromPct: l.fromPct, toPct: l.toPct }
    : { bob: l.bob, layer: l.layer, fromPct: l.fromPct, toPct: l.toPct };
}

/**
 * The overlays an upgrading building reveals on top of its still-drawn old-tier body: the type's
 * `upgrade === 1` rows, revealed across their window like a construction stage. Unlike
 * {@link resolveConstructionDraws} there is no lowest-stage fallback, since outside every window the
 * old body alone is the correct draw. The rows are extracted; composing them over the old body is a
 * named approximation, as the original's upgrade-pass compositing is unknown.
 */
export function resolveUpgradeDraws(
  binding: number | BuildingTypeBinding,
  item: DrawItem,
): ConstructionDraw[] | null {
  if (typeof binding === 'number' || item.upgradePct === undefined || item.typeId === undefined) return null;
  const layers = byTypeFor(binding, item, (t) => t.upgradeByType);
  if (layers === undefined || layers.length === 0) return null;
  const pct = item.upgradePct;
  const active = layers.filter((l) => pct >= l.fromPct && pct <= l.toPct);
  if (active.length === 0) return null;
  return active.map(stageDraw);
}

/**
 * Map progress (0..1) into a stage's `[fromPct, toPct]` window as the 0-255 TimeMask threshold, the
 * `time` of the observed rule that a pixel draws once its `timeByte <= time`. The linear window-to-byte
 * mapping is a named approximation, as the original caller's mapping is not established. A degenerate
 * window (`toPct <= fromPct`) snaps whole.
 */
export function buildTimeThreshold(progress: number, fromPct: number, toPct: number): number {
  const pct = progress * 100;
  if (toPct <= fromPct) return pct >= fromPct ? 255 : 0;
  const t = Math.min(1, Math.max(0, (pct - fromPct) / (toPct - fromPct)));
  return Math.round(t * 255);
}

/**
 * A finished building's state overlay, or `null` when none applies. A state with no bound frames draws
 * no overlay rather than borrowing the other state's.
 */
export function resolveBuildingOverlayDraw(
  binding: number | BuildingTypeBinding,
  item: DrawItem,
  tick: number,
): BuildingDraw | null {
  if (typeof binding === 'number' || item.typeId === undefined || item.builtPct !== undefined) return null;
  if (item.upgradePct !== undefined) return null;
  const overlay = byTypeFor(binding, item, (t) => t.overlayByType);
  if (overlay === undefined) return null;
  const spin = item.working === true ? overlay.working : undefined;
  if (spin !== undefined && spin.length > 0) {
    const ticksPerFrame = Math.max(1, overlay.ticksPerFrame ?? 1);
    const bob = spin[Math.floor(tick / ticksPerFrame) % spin.length];
    if (bob === undefined) return null; // unreachable (index < length), proven instead of asserted
    return overlay.layer === undefined ? { bob } : { bob, layer: overlay.layer };
  }
  if (overlay.idle === undefined) return null;
  return overlay.layer === undefined ? { bob: overlay.idle } : { bob: overlay.idle, layer: overlay.layer };
}

/**
 * A node's `level` indexes its good's empty-to-full frames. When `levels` differs from the record's own
 * state count the ladder is rescaled (`ceil(level*frames/levels)`), because a record-less scene carries
 * the catalog count while a full deposit must still draw its fullest authored frame. A ground drop
 * carries `fill` instead; carrying neither draws the full, last frame.
 */
export function resolveResourceDraw(
  binding: number | ResourceTypeBinding,
  item: DrawItem,
): BuildingDraw | null {
  if (typeof binding === 'number') return { bob: binding };
  const variantFrames = item.gfxIndex !== undefined ? binding.byGfxIndex?.[item.gfxIndex] : undefined;
  const frames = variantFrames ?? (item.goodType !== undefined ? binding.byGood[item.goodType] : undefined);
  if (frames === undefined || frames.length === 0) return unwrapBobRef(binding.default);
  const ladder = item.level ?? item.fill;
  const span = item.level !== undefined && item.levels !== undefined && item.levels > 0 ? item.levels : null;
  const scaled =
    ladder === undefined
      ? frames.length
      : span !== null && span !== frames.length
        ? Math.ceil((ladder * frames.length) / span)
        : ladder;
  const idx = fillFrameIndex(scaled, frames.length);
  const ref = frames[idx];
  if (ref === null) return null;
  return unwrapBobRef(ref ?? binding.default);
}

/** A pile with no good is a bare collection point and draws the delivery flag's wave frame at `tick`. */
export function resolveStockpileDraw(
  binding: number | StockpileBinding,
  item: DrawItem,
  tick: number,
): BuildingDraw {
  if (typeof binding === 'number') return { bob: binding };
  if (item.goodType === undefined) return unwrapBobRef(waveFrameAt(binding.flag, tick));
  const frames = binding.byGood[item.goodType];
  if (frames === undefined || frames.length === 0) return unwrapBobRef(binding.default);
  const idx = fillFrameIndex(item.fill ?? 1, frames.length);
  return unwrapBobRef(frames[idx] ?? binding.default);
}

/**
 * The post when the item has no `boardIndex`, else that angular board frame clamped into the bound
 * list, drawn from the owner's recolour variant when one is bound.
 */
export function resolveSignpostDraw(
  binding: SignpostBinding | undefined,
  item: DrawItem,
): BuildingDraw | null {
  if (binding === undefined) return null;
  const b = (item.player !== undefined ? binding.byPlayer?.[item.player] : undefined) ?? binding;
  if (item.boardIndex === undefined) return unwrapBobRef(b.post);
  const board = b.boards[Math.min(b.boards.length - 1, Math.max(0, item.boardIndex))];
  return board === undefined ? null : unwrapBobRef(board);
}

/** The frame a staged effect loops to at `tick`, one frame per tick, or `null` for an effect whose record
 *  the binding never loaded. */
export function resolveCraftFxDraw(
  binding: CraftFxBinding | undefined,
  item: DrawItem,
  tick: number,
): BuildingDraw | null {
  const loop = item.fxName === undefined ? undefined : binding?.byName[item.fxName];
  if (loop === undefined) return null;
  const bob = loop.frames[((tick % loop.frames.length) + loop.frames.length) % loop.frames.length];
  return bob === undefined ? null : { bob, layer: loop.layer };
}
