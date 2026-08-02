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

/** The building branch's outcome: either a finished stack it resolved on its own (`done`), or a
 *  fall-through carrying the default-layer `bobId` + the extra layers (state overlay / upgrade stack)
 *  the shared body block appends above the body. */
type BuildingBranch =
  | { readonly done: true; readonly layers: ResolvedLayer[] | null }
  | { readonly done: false; readonly bobId: number; readonly extras: readonly ResolvedLayer[] };

/**
 * Resolve a building's atlas layers. An under-construction building returns its active construction-stage
 * stack (grey foundation → stages → body, in stacking order); a finished building either returns its
 * named-family body [+ extras] directly, or falls through (`done: false`) with the default
 * building-layer `bobId` so the shared body block draws it. The extras drawn above the body are a
 * finished building's animated state overlay (the mill's rotor) or an UPGRADING building's revealing
 * next-tier stack ({@link resolveUpgradeDraws} - the old body keeps drawing; the new tier materialises
 * over it). Each stage/body resolves through the same family/default-layer decision
 * ({@link layeredLayerFor}).
 */
export function resolveBuildingLayers(sheet: SpriteSheet, item: DrawItem, tick: number): BuildingBranch {
  // A stage whose frame is missing/empty is skipped; if no stage resolves, fall through to the body.
  const stack = resolveConstructionDraws(sheet.bindings.building, item);
  if (stack !== null && typeof sheet.bindings.building !== 'number') {
    // Each active stage reveals as the build progresses (the pool eases the displayed value between
    // the sim's per-swing steps). A stage whose atlas carries a time sheet reveals per-pixel in its
    // own [fromPct,toPct] window - the original's model, where even the finished-house bob listed as
    // the stack's top stage materialises pixel by pixel. Without time data a stage falls back to the
    // bottom-up crop, and a finished building sprite is excluded from that rise (it would creep up as
    // a half-built cottage) - it snaps in at completion.
    const layers = revealingStageLayers(sheet, stack, item.builtPct);
    if (layers.length > 0) return { done: true, layers };
  }
  const draw = resolveBuildingDraw(sheet.bindings.building, item);
  const extras: ResolvedLayer[] = [];
  const overlayDraw = resolveBuildingOverlayDraw(sheet.bindings.building, item, tick);
  if (overlayDraw !== null) {
    const resolved = layeredLayerFor(sheet, 'building', overlayDraw);
    // The spin frames must not move the entity's box - see ResolvedLayer.boundsExempt.
    if (resolved !== null) extras.push({ ...resolved, boundsExempt: true });
  }
  // An upgrading building keeps its old-tier body draw and reveals the next tier's stack above it -
  // the same per-pixel/crop reveal rules as a construction stage, driven by `upgradePct`.
  const upgradeStack = resolveUpgradeDraws(sheet.bindings.building, item);
  if (upgradeStack !== null && typeof sheet.bindings.building !== 'number') {
    extras.push(...revealingStageLayers(sheet, upgradeStack, item.upgradePct));
  }
  // A loaded named family resolves through the shared helper (missing/empty frame → placeholder); an
  // unloaded one falls through to the default building layer (a deliberate difference from the
  // construction path, which drops the stage instead).
  if (hasLoadedFamily(sheet, draw)) {
    const layers = layeredLayersWithShadow(sheet, 'building', draw);
    if (layers === null) return { done: true, layers: null }; // a broken body never draws floating extras
    layers.push(...extras);
    return { done: true, layers };
  }
  return { done: false, bobId: draw.bob, extras };
}

/**
 * Resolve a stage stack's drawable layers at a rise progress (a from-scratch site's `builtPct` or an
 * upgrade's `upgradePct`): a stage whose atlas carries a time sheet reveals per-pixel in its own
 * window; one without time data crop-rises, except a finished-building sprite, which snaps in at
 * completion instead of creeping up ({@link finishedBuildingBobKeys}) - for an upgrade stack (whose
 * bobs ARE the next tier's finished body) that means the old body alone shows until the time-mask
 * atlas is available. A stage whose frame is missing/empty is skipped.
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
