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
import { hasLoadedFamily, layeredLayerFor, layeredLayersWithShadow } from './layered-layers.js';
import type { ResolvedLayer } from './resolved-layer.js';

/** Either a stack the branch resolved on its own, or a fall-through carrying the default-layer `bobId`
 *  plus the extra layers the shared body block appends above the body. */
type BuildingBranch =
  | { readonly done: true; readonly layers: ResolvedLayer[] | null }
  | { readonly done: false; readonly bobId: number; readonly extras: readonly ResolvedLayer[] };

/**
 * Resolve a building's atlas layers. An under-construction building returns its active construction-stage
 * stack in stacking order; a finished building returns its named-family body plus extras, or falls
 * through with the default building-layer `bobId` for the shared body block to draw.
 */
export function resolveBuildingLayers(sheet: SpriteSheet, item: DrawItem, tick: number): BuildingBranch {
  const stack = resolveConstructionDraws(sheet.bindings.building, item);
  if (stack !== null && typeof sheet.bindings.building !== 'number') {
    const layers = revealingStageLayers(sheet, stack, item.builtPct);
    if (layers.length > 0) return { done: true, layers };
  }
  const draw = resolveBuildingDraw(sheet.bindings.building, item);
  const extras: ResolvedLayer[] = [];
  const overlayDraw = resolveBuildingOverlayDraw(sheet.bindings.building, item, tick);
  if (overlayDraw !== null) {
    const resolved = layeredLayerFor(sheet, 'building', overlayDraw);
    if (resolved !== null) extras.push({ ...resolved, boundsExempt: true });
  }
  // An upgrading building keeps its old-tier body and reveals the next tier's stack above it.
  const upgradeStack = resolveUpgradeDraws(sheet.bindings.building, item);
  if (upgradeStack !== null && typeof sheet.bindings.building !== 'number') {
    extras.push(...revealingStageLayers(sheet, upgradeStack, item.upgradePct));
  }
  // An unloaded family falls through to the default building layer - deliberately unlike the
  // construction path, which drops the stage instead.
  if (hasLoadedFamily(sheet, draw)) {
    const layers = layeredLayersWithShadow(sheet, 'building', draw);
    if (layers === null) return { done: true, layers: null }; // a broken body never draws floating extras
    layers.push(...extras);
    return { done: true, layers };
  }
  return { done: false, bobId: draw.bob, extras };
}

/**
 * A stage stack's drawable layers at a rise progress (`builtPct` or `upgradePct`): a stage with a time
 * sheet reveals per-pixel in its own window, one without crop-rises, and a finished-building sprite is
 * dropped from the crop rise rather than creeping up as a half-built cottage. An upgrade stack, whose
 * bobs are the next tier's finished body, therefore shows nothing until a time-mask atlas exists.
 */
function revealingStageLayers(
  sheet: SpriteSheet,
  stack: readonly ConstructionDraw[],
  progressPct: number | undefined,
): ResolvedLayer[] {
  const binding = sheet.bindings.building;
  if (typeof binding === 'number') return [];
  const finishedKeys = finishedBuildingBobKeys(binding);
  const reveal = clamp01((progressPct ?? 0) / 100);
  const layers: ResolvedLayer[] = [];
  for (const draw of stack) {
    const resolved = layeredLayerFor(sheet, 'building', draw);
    if (resolved === null) continue;
    if (resolved.times !== undefined) {
      layers.push({ ...resolved, reveal, revealWindow: [draw.fromPct, draw.toPct] });
    } else if (!finishedKeys.has(bobKey(draw))) {
      layers.push({ ...resolved, reveal });
    }
  }
  return layers;
}
