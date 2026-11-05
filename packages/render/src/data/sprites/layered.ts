import { screenToHalfCellSum } from '../projection/index.js';
import type { DrawItem } from '../scene/index.js';
import type {
  AuthoredBuildingDraw,
  BuildingBobRef,
  BuildingDraw,
  BuildingLandscapeOverlayRef,
  BuildingSkinTables,
  BuildingTribeTables,
  BuildingTypeBinding,
  ConstructionLayerRef,
  CraftFxBinding,
  LayeredBobRef,
  PalisadeBinding,
  ResourceLoopRef,
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
    for (const tribe of [binding, ...Object.values(binding.byTribe ?? {})]) {
      for (const tables of [tribe, ...(tribe.altSkins ?? [])]) {
        for (const ref of Object.values(tables.byType)) set.add(bobKey(unwrapBobRef(ref)));
      }
    }
    for (const { body } of binding.byEntity?.values() ?? []) set.add(bobKey(unwrapBobRef(body)));
    set.add(bobKey(unwrapBobRef(binding.default)));
    keys = set;
    finishedKeyCache.set(binding, keys);
  }
  return keys;
}

/** The palette skin a building draws from its tribe's tables, picked by its entity id. An id-less item
 *  (a negative placeholder ref) draws slot 0. */
function skinFor(tribe: BuildingTribeTables, ref: number): BuildingSkinTables {
  const alts = tribe.altSkins;
  if (alts === undefined || alts.length === 0) return tribe;
  const slot = Math.max(0, ref) % (alts.length + 1);
  return slot === 0 ? tribe : (alts[slot - 1] ?? tribe);
}

/** The item's tribe skin, or the base tables for an item of no or an unloaded tribe. */
function tablesFor(binding: BuildingTypeBinding, item: DrawItem): BuildingSkinTables {
  return skinFor((item.tribe !== undefined ? binding.byTribe?.[item.tribe] : undefined) ?? binding, item.ref);
}

/** The per-type table read: the tribe's own row, else the base tribe's, else `undefined`. */
function byTypeFor<T>(
  binding: BuildingTypeBinding,
  item: DrawItem,
  table: (tables: BuildingSkinTables) => Readonly<Record<number, T>> | undefined,
  typeId: number | undefined = item.typeId,
): T | undefined {
  if (typeId === undefined) return undefined;
  return table(tablesFor(binding, item))?.[typeId] ?? table(skinFor(binding, item.ref))?.[typeId];
}

/** An unmapped or type-less item falls back to `default`, so a sparse table is always total. */
export function resolveBuildingDraw(binding: number | BuildingTypeBinding, item: DrawItem): BuildingDraw {
  if (typeof binding === 'number') return { bob: binding };
  const authored = authoredDrawOf(binding, item);
  if (authored !== undefined) return unwrapBobRef(authored.body);
  return unwrapBobRef(
    bodyAtLevel(tablesFor(binding, item), item) ??
      bodyAtLevel(skinFor(binding, item.ref), item) ??
      binding.default,
  );
}

/** The item's authored body choice while it still applies: the same type and tribe, and no level its
 *  tables draw apart from the authored one, as a wonder stands at after a scripted level change. */
function authoredDrawOf(binding: BuildingTypeBinding, item: DrawItem): AuthoredBuildingDraw | undefined {
  const authored = binding.byEntity?.get(item.ref);
  if (authored === undefined || authored.typeId !== item.typeId || authored.tribe !== item.tribe) {
    return undefined;
  }
  const { typeId, level } = item;
  if (typeId === undefined || level === undefined || level === authored.level) return authored;
  const own = tablesFor(binding, item).byTypeLevel?.[typeId]?.[level];
  return (own ?? skinFor(binding, item.ref).byTypeLevel?.[typeId]?.[level]) === undefined
    ? authored
    : undefined;
}

/** One table set's body for the item's type, at its level when the set draws that level apart; the level
 *  table is read only beside the set's own `byType` row, so a tribe never borrows another's stage art. */
function bodyAtLevel(tables: BuildingSkinTables, item: DrawItem): BuildingBobRef | undefined {
  if (item.typeId === undefined) return undefined;
  const body = tables.byType[item.typeId];
  if (body === undefined || item.level === undefined) return body;
  return tables.byTypeLevel?.[item.typeId]?.[item.level] ?? body;
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
  if (typeof binding === 'number' || item.builtPct === undefined) return null;
  return constructionStack(binding, item, item.typeId, item.builtPct);
}

/**
 * The target tier's from-scratch construction stack at an upgrading building's progress, or `null` when it
 * is not upgrading or the target has no stack. Its foundation and timber stages rise in front of the old
 * body, so an upgrade reads as building work; its body stage stands in for the next tier's body only where
 * {@link resolveUpgradeDraws} has no row. Raising the target's stages over the old body is a named
 * approximation, as the original's upgrade-pass compositing is unknown.
 */
export function resolveUpgradeConstructionDraws(
  binding: number | BuildingTypeBinding,
  item: DrawItem,
): ConstructionDraw[] | null {
  if (typeof binding === 'number' || item.upgradePct === undefined || item.upgradeTypeId === undefined)
    return null;
  return constructionStack(binding, item, item.upgradeTypeId, item.upgradePct);
}

/** Whether the drawing tribe's upgrade rows show this upgrade: they hold only the next tier's body, so
 *  a site skipping tiers rises as its target's construction stack instead. */
export function raisesUpgradeRows(binding: number | BuildingTypeBinding, item: DrawItem): boolean {
  if (
    typeof binding === 'number' ||
    item.upgradePct === undefined ||
    item.typeId === undefined ||
    tablesFor(binding, item).upgradeByType?.[item.typeId] === undefined
  )
    return false;
  return item.upgradeTypeId === binding.upgradeTargetByType?.[item.typeId];
}

function constructionStack(
  binding: BuildingTypeBinding,
  item: DrawItem,
  typeId: number | undefined,
  pct: number,
): ConstructionDraw[] | null {
  const layers = byTypeFor(binding, item, (t) => t.constructionByType, typeId);
  if (layers === undefined || layers.length === 0) return null;
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
 * old body alone is the correct draw. The rows are the drawing tribe's own and never the base tribe's,
 * since each row is that tribe's next-tier body. The mod authors them almost only for the viking skin and
 * only for the next tier; every other upgrade takes its body from {@link resolveUpgradeConstructionDraws}.
 * The rows are extracted; composing them over the old body is a named approximation.
 */
export function resolveUpgradeDraws(
  binding: number | BuildingTypeBinding,
  item: DrawItem,
): ConstructionDraw[] | null {
  if (typeof binding === 'number' || item.upgradePct === undefined || item.typeId === undefined) return null;
  if (!raisesUpgradeRows(binding, item)) return null;
  const layers = tablesFor(binding, item).upgradeByType?.[item.typeId];
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

/** A resource draw; `looping` marks a frame of a {@link ResourceLoopRef}, which changes with the tick. */
export interface ResourceDraw extends BuildingDraw {
  readonly looping?: true;
}

/**
 * A node's `level` indexes its good's empty-to-full frames. When `levels` differs from the record's own
 * state count the ladder is rescaled (`ceil(level*frames/levels)`), because a record-less scene carries
 * the catalog count while a full deposit must still draw its fullest authored frame. A ground drop
 * carries `fill` instead; carrying neither draws the full, last frame. A looping level plays at `tick`,
 * or holds its first frame without one.
 */
export function resolveResourceDraw(
  binding: number | ResourceTypeBinding,
  item: DrawItem,
  tick?: number,
): ResourceDraw | null {
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
  if (ref !== undefined && typeof ref !== 'number' && 'frames' in ref) return loopFrameAt(ref, item, tick);
  return unwrapBobRef(ref ?? binding.default);
}

/**
 * The loop's frame at `tick`, phased by the node's half-cell `hx + hy` exactly as the map-object layer
 * phases a placed record, so a tree the sim takes over from the map keeps its step.
 */
function loopFrameAt(loop: ResourceLoopRef, item: DrawItem, tick: number | undefined): ResourceDraw {
  const n = loop.frames.length;
  const layer = loop.layer === undefined ? {} : { layer: loop.layer };
  if (tick === undefined || n === 1) return { bob: loop.frames[0], ...layer };
  const phase = screenToHalfCellSum(item.x, item.y);
  const bob = loop.frames[(((Math.floor(tick) + phase) % n) + n) % n] ?? loop.frames[0];
  return { bob, ...layer, looping: true };
}

/** Select a wall post's durability/construction-height frame. Source rows are reversed by the app into
 * shortest-to-full order; 0/20/40/60/80 percent advance the five original states. */
export function resolvePalisadeDraw(
  binding: number | PalisadeBinding,
  item: Pick<DrawItem, 'gfxIndex' | 'builtPct'> & { readonly variantStep?: number },
  player?: number,
): BuildingDraw {
  if (typeof binding === 'number') return { bob: binding };
  let gfxIndex = item.gfxIndex;
  const order = binding.variantOrder;
  if (gfxIndex !== undefined && item.variantStep !== undefined && order !== undefined && order.length > 0) {
    const at = order.indexOf(gfxIndex);
    if (at >= 0) gfxIndex = order[(at + item.variantStep) % order.length];
  }
  const own = player === undefined ? undefined : binding.byPlayer?.[player];
  const frames = gfxIndex === undefined ? undefined : (own?.[gfxIndex] ?? binding.byGfxIndex[gfxIndex]);
  if (frames === undefined || frames.length === 0) return unwrapBobRef(binding.default);
  const index =
    item.builtPct === undefined
      ? frames.length - 1
      : Math.min(frames.length - 1, Math.floor((item.builtPct * frames.length) / 100));
  return unwrapBobRef(frames[index] ?? binding.default);
}

/** A pile with no good is a bare collection point and draws the delivery flag's wave frame at `tick`. */
export function resolveStockpileDraw(
  binding: number | StockpileBinding,
  item: DrawItem,
  tick: number,
): BuildingDraw {
  if (typeof binding === 'number') return { bob: binding };
  if (item.goodType === undefined) {
    const flag =
      item.player === undefined || binding.flagsByPlayer === undefined
        ? binding.flag
        : binding.flagsByPlayer[item.player];
    return unwrapBobRef(flag === undefined ? binding.default : waveFrameAt(flag, tick));
  }
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

/** The frame a staged effect loops to at `tick`, one frame per whole tick of the smooth animation clock,
 *  or `null` for an effect whose record the binding never loaded. */
export function resolveCraftFxDraw(
  binding: CraftFxBinding | undefined,
  item: DrawItem,
  tick: number,
): BuildingDraw | null {
  const loop = item.fxName === undefined ? undefined : binding?.byName[item.fxName];
  if (loop === undefined) return null;
  const n = loop.frames.length;
  const bob = loop.frames[((Math.floor(tick) % n) + n) % n];
  return bob === undefined ? null : { bob, layer: loop.layer };
}

const NO_LANDSCAPE_OVERLAYS: readonly BuildingLandscapeOverlayRef[] = [];

/** The level a building item without a `Building.level` stands at: its type's first tier. */
const FIRST_LEVEL = 0;

/** The landscape overlay slots the item's body draws at its level: the authored record's while its body
 *  applies, else its type's. */
export function buildingLandscapeOverlays(
  binding: number | BuildingTypeBinding,
  item: DrawItem,
): readonly BuildingLandscapeOverlayRef[] {
  if (
    typeof binding === 'number' ||
    item.builtPct !== undefined ||
    item.upgradePct !== undefined ||
    !item.landscapeOverlayMask
  )
    return NO_LANDSCAPE_OVERLAYS;
  const authored = authoredDrawOf(binding, item)?.landscapeOverlays;
  if (authored !== undefined) return authored;
  const byLevel = byTypeFor(binding, item, (tables) => tables.landscapeOverlaysByType);
  return byLevel?.[item.level ?? FIRST_LEVEL] ?? NO_LANDSCAPE_OVERLAYS;
}
