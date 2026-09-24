import { clamp01 } from '../../data/math.js';
import type { DrawItem } from '../../data/scene/index.js';
import {
  bobKey,
  type ConstructionDraw,
  finishedBuildingBobKeys,
  resolveBuildingDraw,
  resolveBuildingOverlayDraw,
  resolveConstructionDraws,
  resolveUpgradeDraws,
} from '../../data/sprites/index.js';
import type { SpriteSheet } from '../sprite-sheet.js';
import { hasLoadedFamily, layeredLayerFor, pushLayeredWithShadow } from './layered-layers.js';
import type { LayerBuffer, ResolvedLayer } from './resolved-layer.js';

/** A state overlay's bounds-exempt twin of its memoized record (see {@link layeredLayerFor}). */
const overlayRecords = new WeakMap<ResolvedLayer, ResolvedLayer>();

/**
 * Append a building's atlas layers: an under-construction building's active construction-stage stack in
 * stacking order, or a finished building's named-family body plus {@link pushBuildingExtras}. True when
 * drawn, false for the placeholder, or the default building-layer bob id with nothing appended, for the
 * shared body block to draw before it appends the extras.
 */
export function pushBuildingLayers(
  out: LayerBuffer,
  sheet: SpriteSheet,
  item: DrawItem,
  tick: number,
): boolean | number {
  const stack = resolveConstructionDraws(sheet.bindings.building, item);
  if (stack !== null && pushRevealingStages(out, sheet, stack, item.builtPct)) return true;
  const draw = resolveBuildingDraw(sheet.bindings.building, item);
  // An unloaded family falls through to the default building layer - deliberately unlike the
  // construction path, which drops the stage instead.
  if (!hasLoadedFamily(sheet, draw)) return draw.bob;
  // A broken body never draws floating extras.
  if (!pushLayeredWithShadow(out, sheet, 'building', draw)) return false;
  pushBuildingExtras(out, sheet, item, tick);
  return true;
}

/**
 * The layers above a finished building's body: its animated state overlay (the mill's rotor) and, for an
 * upgrading building that keeps its old-tier body, the next tier's revealing stack.
 */
export function pushBuildingExtras(out: LayerBuffer, sheet: SpriteSheet, item: DrawItem, tick: number): void {
  const overlayDraw = resolveBuildingOverlayDraw(sheet.bindings.building, item, tick);
  if (overlayDraw !== null) {
    const resolved = layeredLayerFor(sheet, 'building', overlayDraw);
    if (resolved !== null) out.push(boundsExemptLayerFor(resolved));
  }
  const upgradeStack = resolveUpgradeDraws(sheet.bindings.building, item);
  if (upgradeStack !== null) pushRevealingStages(out, sheet, upgradeStack, item.upgradePct);
}

function boundsExemptLayerFor(of: ResolvedLayer): ResolvedLayer {
  let record = overlayRecords.get(of);
  if (record === undefined) {
    record = { ...of, boundsExempt: true };
    overlayRecords.set(of, record);
  }
  return record;
}

/**
 * Append a stage stack's drawable layers at a rise progress (`builtPct` or `upgradePct`), true when any
 * drew: a stage with a time sheet reveals per-pixel in its own window, one without crop-rises, and a
 * finished-building sprite is dropped from the crop rise rather than creeping up as a half-built
 * cottage. An upgrade stack, whose bobs are the next tier's finished body, therefore shows nothing until
 * a time-mask atlas exists.
 */
function pushRevealingStages(
  out: LayerBuffer,
  sheet: SpriteSheet,
  stack: readonly ConstructionDraw[],
  progressPct: number | undefined,
): boolean {
  const binding = sheet.bindings.building;
  if (typeof binding === 'number') return false;
  const finishedKeys = finishedBuildingBobKeys(binding);
  const reveal = clamp01((progressPct ?? 0) / 100);
  const before = out.length;
  for (const draw of stack) {
    const resolved = layeredLayerFor(sheet, 'building', draw);
    if (resolved === null) continue;
    if (resolved.times !== undefined) {
      out.push({ ...resolved, reveal, revealWindow: [draw.fromPct, draw.toPct] });
    } else if (!finishedKeys.has(bobKey(draw))) {
      out.push({ ...resolved, reveal });
    }
  }
  return out.length > before;
}
