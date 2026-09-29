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
  resolveUpgradeRebuildDraws,
} from '../../data/sprites/index.js';
import type { SpriteSheet } from '../sprite-sheet.js';
import { hasLoadedFamily, layeredLayerFor, pushGroundedBody } from './layered-layers.js';
import type { LayerBuffer, ResolvedLayer } from './resolved-layer.js';

/** A state overlay's bounds-exempt twin of its memoized record (see {@link layeredLayerFor}). */
const overlayRecords = new WeakMap<ResolvedLayer, ResolvedLayer>();
/** An old body part's fading twin, for an upgrade site that rebuilds its next tier. */
const fadingRecords = new WeakMap<ResolvedLayer, ResolvedLayer>();

/**
 * Where a rebuilt upgrade's old body starts fading, so the parts of it the next tier does not cover are
 * gone by completion instead of snapping away. A named approximation, picked by eye.
 */
const OLD_BODY_FADE_FROM_PCT = 85;

/** Which stages of a stack to append: all of them, only the next tier's finished body, or only the rest
 *  (foundations and scaffolds, whose art shows the back walls). */
type StagePart = 'all' | 'body' | 'work';

/**
 * Append a building's atlas layers: an under-construction building's active construction-stage stack in
 * stacking order, or a finished building's named-family body plus {@link pushBuildingExtras}. True when
 * drawn, false for the placeholder, or the default building-layer bob id with nothing appended: the
 * `kindLayers` body then draws it and appends the extras, while the sheet-global body draws none.
 */
export function pushBuildingLayers(
  out: LayerBuffer,
  sheet: SpriteSheet,
  item: DrawItem,
  tick: number,
): boolean | number {
  const stack = resolveConstructionDraws(sheet.bindings.building, item);
  if (stack !== null && pushRevealingStages(out, sheet, stack, item.builtPct, 'all')) return true;
  const draw = resolveBuildingDraw(sheet.bindings.building, item);
  // An unloaded family falls through to the default building layer - deliberately unlike the
  // construction path, which drops the stage instead.
  if (!hasLoadedFamily(sheet, draw)) return draw.bob;
  // A rebuilt upgrade's scaffolds stand behind the old body, which hides their back walls; its finished
  // body stage rises in front as a pushBuildingExtras layer, since that art holds only the front faces.
  const rebuild = resolveUpgradeRebuildDraws(sheet.bindings.building, item);
  if (rebuild !== null) pushRevealingStages(out, sheet, rebuild, item.upgradePct, 'work');
  // A broken body never draws floating extras.
  if (!pushGroundedBody(out, sheet, 'building', draw, rebuild !== null ? fadingLayerFor : undefined))
    return false;
  pushBuildingExtras(out, sheet, item, tick);
  return true;
}

/**
 * The layers above a finished building's body: its animated state overlay (the mill's rotor) and, for an
 * upgrading building that keeps its old-tier body, the next tier's revealing stack (its upgrade rows, or
 * without them its construction stack).
 */
export function pushBuildingExtras(out: LayerBuffer, sheet: SpriteSheet, item: DrawItem, tick: number): void {
  const overlayDraw = resolveBuildingOverlayDraw(sheet.bindings.building, item, tick);
  if (overlayDraw !== null) {
    const resolved = layeredLayerFor(sheet, 'building', overlayDraw);
    if (resolved !== null) out.push(boundsExemptLayerFor(resolved));
  }
  const upgradeStack = resolveUpgradeDraws(sheet.bindings.building, item);
  if (upgradeStack !== null) {
    pushRevealingStages(out, sheet, upgradeStack, item.upgradePct, 'all');
    return;
  }
  const rebuild = resolveUpgradeRebuildDraws(sheet.bindings.building, item);
  if (rebuild !== null) pushRevealingStages(out, sheet, rebuild, item.upgradePct, 'body');
}

function fadingLayerFor(of: ResolvedLayer): ResolvedLayer {
  let record = fadingRecords.get(of);
  if (record === undefined) {
    record = { ...of, fadeOutFromPct: OLD_BODY_FADE_FROM_PCT };
    fadingRecords.set(of, record);
  }
  return record;
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
  part: StagePart,
): boolean {
  const binding = sheet.bindings.building;
  if (typeof binding === 'number') return false;
  const finishedKeys = finishedBuildingBobKeys(binding);
  const reveal = clamp01((progressPct ?? 0) / 100);
  const before = out.length;
  for (const draw of stack) {
    if (part !== 'all' && finishedKeys.has(bobKey(draw)) !== (part === 'body')) continue;
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
