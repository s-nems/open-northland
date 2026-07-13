import type { BuildingOverlayRef } from '@open-northland/render';
import type { BuildingOverlayRow } from '../ir.js';
import { type BuildingFamily, familyLayerFor, preferredPalettePool, rowsByType } from './families.js';

/** The source's overlay-state discriminators (`GfxOverlay <sizeIdx> 4 <state> …`). */
const OVERLAY_STATE_IDLE = 0;
const OVERLAY_STATE_WORKING = 1;

/**
 * Sim ticks per spin frame for a WORKING building overlay (the mill's rotor). The source's `step`
 * field is `1` on every type-4 row and its unit is undecoded, so the pace is a NAMED APPROXIMATION
 * tuned by eye against the original (13 spin frames × 2 ticks ≈ a 1.3 s revolution at ×1 speed) —
 * a human validates it in the mill scene; swap the constant to taste (source basis "observed").
 */
export const OVERLAY_TICKS_PER_FRAME = 2;

/**
 * Reduce the decoded `buildingOverlays` IR (the `extractBuildingOverlays` leg — the `[GfxHouse]`
 * type-4 `GfxOverlay` rows) to the render's per-type animated-state-overlay binding for ONE tribe:
 * the mill's bladeless body gets its rotor — the state-0 row's single frame as the still `idle`
 * blade, the state-1 row's frame list as the `working` spin cycle. Shares
 * {@link import('./families.js').buildingBobRefsByType}'s family rules (palette preference, the
 * no-wrong-bob-borrow drop of an unloaded family) and
 * {@link import('./construction.js').constructionRefsByType}'s one-source-record stance (lowest `level`
 * group, deterministic). A type with neither state row is simply absent (no overlay drawn).
 */
export function buildingOverlayRefsByType(
  rows: readonly BuildingOverlayRow[],
  tribeId: number,
  defaultFamily: { readonly bmdBasename: string; readonly paletteName: string },
  families: readonly BuildingFamily[],
): Record<number, BuildingOverlayRef> {
  const byType = rowsByType(rows, tribeId);
  const out: Record<number, BuildingOverlayRef> = {};
  for (const [typeId, list] of byType) {
    const pool = preferredPalettePool(list, defaultFamily.paletteName);
    const lowestLevel = pool.reduce((lo, r) => Math.min(lo, r.level), Number.POSITIVE_INFINITY);
    const group = pool.filter((r) => r.level === lowestLevel);
    const idleRow = group.find((r) => r.state === OVERLAY_STATE_IDLE);
    const workingRow = group.find((r) => r.state === OVERLAY_STATE_WORKING);
    const anchor = idleRow ?? workingRow;
    if (anchor === undefined) continue;
    // NAMED LIMITATION: the row's x/y draw offset is not carried into the binding yet — every pinned
    // viking overlay row is `0 0`, so the overlay anchors like the body bob. A mod row with a real
    // offset would draw misplaced; surface it instead of failing silently.
    if (anchor.x !== 0 || anchor.y !== 0) {
      console.warn(
        `building overlay type ${typeId}: nonzero offset ${anchor.x},${anchor.y} ignored (not implemented)`,
      );
    }
    const layer = familyLayerFor(anchor.bmd, anchor.paletteName, defaultFamily, families);
    if (layer === null) continue; // family not loaded → no overlay (never a wrong-bob borrow)
    const idle = idleRow?.frames[0];
    const working = workingRow !== undefined && workingRow.frames.length > 0 ? workingRow.frames : undefined;
    if (idle === undefined && working === undefined) continue;
    out[typeId] = {
      ...(layer.layer !== undefined ? { layer: layer.layer } : {}),
      ...(idle !== undefined ? { idle } : {}),
      ...(working !== undefined ? { working } : {}),
      ticksPerFrame: OVERLAY_TICKS_PER_FRAME,
    };
  }
  return out;
}
