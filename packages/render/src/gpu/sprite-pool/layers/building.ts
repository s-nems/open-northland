import { clamp01 } from '../../../data/math.js';
import type { DrawItem } from '../../../data/scene/index.js';
import {
  type BuildingDraw,
  bobKey,
  type ConstructionDraw,
  finishedBuildingBobKeys,
  raisesUpgradeRows,
  resolveBuildingDoorDraw,
  resolveBuildingDraw,
  resolveBuildingOverlayDraw,
  resolveConstructionDraws,
  resolveUpgradeConstructionDraws,
  resolveUpgradeDraws,
  resolveUpgradeTargetDraw,
} from '../../../data/sprites/index.js';
import { buildingLandscapeOverlays } from '../../../data/sprites/layered.js';
import type { BuildingLandscapeOverlayRef } from '../../../data/sprites/layered-bindings.js';
import type { SpriteSheet } from '../../textures/sprite-sheet.js';
import { hasLoadedFamily, layeredLayerFor, pushGroundedBody } from './layered.js';
import type { LayerBuffer, ResolvedLayer } from './resolved-layer.js';

/** A scripted landscape overlay's resolved layer per frame bob, moved to the overlay's point. */
const landscapeLayers = new WeakMap<BuildingLandscapeOverlayRef, Map<number, ResolvedLayer>>();
/** A state overlay's bounds-exempt twin of its memoized record (see {@link layeredLayerFor}). */
const overlayRecords = new WeakMap<ResolvedLayer, ResolvedLayer>();
/** An old body part's fading twin, for an upgrade site whose next-tier body is a construction stage. */
const fadingRecords = new WeakMap<ResolvedLayer, ResolvedLayer>();
/** A finished body's {@link ResolvedLayer.outlineOnly} twin. */
const outlineRecords = new WeakMap<ResolvedLayer, ResolvedLayer>();

/**
 * Where such an upgrade's old body starts fading, so the parts of it the next tier does not cover are
 * gone by completion instead of snapping away. A named approximation, picked by eye.
 */
const OLD_BODY_FADE_FROM_PCT = 85;

/** Construction's back walls and timber, sampled only inside damage cavities. Exclude finished-tier
 * bodies and incomplete sites so a hole cannot reveal a completed facade or unbuilt upper storey. */
export function damageScaffoldLayers(
  sheet: SpriteSheet | undefined,
  item: DrawItem,
): readonly ResolvedLayer[] {
  if (
    sheet === undefined ||
    item.kind !== 'building' ||
    typeof sheet.bindings.building === 'number' ||
    item.builtPct !== undefined ||
    item.upgradePct !== undefined
  )
    return [];
  const binding = sheet.bindings.building;
  const stack = resolveConstructionDraws(binding, { ...item, builtPct: 99 });
  if (stack === null) return [];
  const finished = finishedBuildingBobKeys(binding);
  const layers: ResolvedLayer[] = [];
  for (const draw of stack) {
    if (finished.has(bobKey(draw))) continue;
    const layer = layeredLayerFor(sheet, 'building', draw);
    if (layer !== null) layers.push(layer);
  }
  return layers;
}

/** Which stages of a stack to append: all of them, only the next tier's finished body, or only the rest
 *  (foundations and scaffolds, whose art shows the back walls). */
type StagePart = 'all' | 'body' | 'work';

/**
 * Append a building's atlas layers: an under-construction building's finished body for its outline alone,
 * then its active construction-stage stack in stacking order, or a finished building's named-family body
 * plus {@link pushBuildingExtras}. True when
 * drawn, false for the placeholder, or the default building-layer bob id with nothing appended: the
 * `kindLayers` body then draws it and appends the extras, while the sheet-global body draws none.
 */
export function pushBuildingLayers(
  out: LayerBuffer,
  sheet: SpriteSheet,
  item: DrawItem,
  tick: number,
): boolean | number {
  const draw = resolveBuildingDraw(sheet.bindings.building, item);
  const stack = resolveConstructionDraws(sheet.bindings.building, item);
  if (stack !== null) {
    pushOutlineOnly(out, sheet, draw);
    if (pushRevealingStages(out, sheet, stack, item.builtPct, 'all')) return true;
  }
  // An unloaded family falls through to the default building layer - deliberately unlike the
  // construction path, which drops the stage instead.
  if (!hasLoadedFamily(sheet, draw)) return draw.bob;
  const fade = risesConstructionBody(sheet, item) ? fadingLayerFor : undefined;
  // A broken body never draws floating extras.
  if (!pushGroundedBody(out, sheet, 'building', draw, fade)) return false;
  pushBuildingExtras(out, sheet, item, tick);
  return true;
}

/**
 * The layers above a finished building's body: its animated state overlay (the mill's rotor), its open
 * door and, for an
 * upgrading building that keeps its old-tier body, the target tier's finished body for its outline alone,
 * the target tier's foundation and timber stages, then its next-tier body from the upgrade rows or else
 * from the construction stack's body stage.
 */
export function pushBuildingExtras(out: LayerBuffer, sheet: SpriteSheet, item: DrawItem, tick: number): void {
  const overlayDraw = resolveBuildingOverlayDraw(sheet.bindings.building, item, tick);
  if (overlayDraw !== null) {
    const resolved = layeredLayerFor(sheet, 'building', overlayDraw);
    if (resolved !== null) out.push(boundsExemptLayerFor(resolved));
  }
  for (const overlay of buildingLandscapeOverlays(sheet.bindings.building, item)) {
    if (((item.landscapeOverlayMask ?? 0) & (1 << overlay.slot)) === 0) continue;
    // Same two-tick approximation as the existing animated building overlay.
    const index = overlay.animated ? Math.floor(tick / 2) % overlay.frames.length : 0;
    const bob = overlay.frames[index];
    if (bob === undefined) continue;
    let frames = landscapeLayers.get(overlay);
    if (frames === undefined) {
      frames = new Map();
      landscapeLayers.set(overlay, frames);
    }
    let layer = frames.get(bob);
    if (layer === undefined) {
      const base = layeredLayerFor(sheet, 'building', { bob, layer: overlay.layer });
      if (base === null) continue;
      layer = { ...base, dx: overlay.x, dy: overlay.y, boundsExempt: true };
      frames.set(bob, layer);
    }
    out.push(layer);
  }
  const doorDraw = resolveBuildingDoorDraw(sheet.bindings.building, item);
  if (doorDraw !== null) {
    const resolved = layeredLayerFor(sheet, 'building', doorDraw);
    if (resolved !== null) out.push(boundsExemptLayerFor(resolved));
  }
  const target = resolveUpgradeTargetDraw(sheet.bindings.building, item);
  if (target !== null) pushOutlineOnly(out, sheet, target);
  // The target's foundation and timber rise in front of the old body, then the next-tier body over them.
  const construction = resolveUpgradeConstructionDraws(sheet.bindings.building, item);
  if (construction !== null) pushRevealingStages(out, sheet, construction, item.upgradePct, 'work');
  if (raisesUpgradeRows(sheet.bindings.building, item)) {
    const rows = resolveUpgradeDraws(sheet.bindings.building, item);
    if (rows !== null) pushRevealingStages(out, sheet, rows, item.upgradePct, 'all');
  } else if (construction !== null) {
    pushRevealingStages(out, sheet, construction, item.upgradePct, 'body');
  }
}

/** Whether an upgrading building's next-tier body comes from its target's construction stack rather than
 *  its upgrade rows; that body does not cover the old one exactly, so the old body fades out. */
function risesConstructionBody(sheet: SpriteSheet, item: DrawItem): boolean {
  return (
    !raisesUpgradeRows(sheet.bindings.building, item) &&
    resolveUpgradeConstructionDraws(sheet.bindings.building, item) !== null
  );
}

function fadingLayerFor(of: ResolvedLayer): ResolvedLayer {
  let record = fadingRecords.get(of);
  if (record === undefined) {
    record = { ...of, fadeOutFromPct: OLD_BODY_FADE_FROM_PCT };
    fadingRecords.set(of, record);
  }
  return record;
}

/** Append `draw`'s finished body as an {@link ResolvedLayer.outlineOnly} layer; an unloaded family adds none. */
function pushOutlineOnly(out: LayerBuffer, sheet: SpriteSheet, draw: BuildingDraw): void {
  const body = layeredLayerFor(sheet, 'building', draw);
  if (body === null) return;
  let record = outlineRecords.get(body);
  if (record === undefined) {
    record = { ...body, alpha: 0, outlineOnly: true, boundsExempt: true };
    outlineRecords.set(body, record);
  }
  out.push(record);
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
