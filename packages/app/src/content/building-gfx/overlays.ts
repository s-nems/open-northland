import type { BuildingOverlayRef } from '@open-northland/render';
import { diag } from '../../diag/index.js';
import type { BuildingOverlayRow } from '../ir/rows.js';
import { type BuildingFamily, familyLayerFor, preferredPalettePool, rowsByType } from './families.js';

/** The source's overlay-state discriminators (`GfxOverlay <sizeIdx> 4 <state> …`). */
const OVERLAY_STATE_IDLE = 0;
const OVERLAY_STATE_WORKING = 1;

/**
 * Sim ticks per spin frame for a working building overlay (the mill's rotor). The source's `step` field is
 * `1` on every type-4 row and its unit is undecoded, so the pace is a named approximation tuned by eye
 * against the original (13 spin frames × 2 ticks ≈ a 1.3 s revolution at ×1 speed).
 */
export const OVERLAY_TICKS_PER_FRAME = 2;

/**
 * Reduce the decoded `buildingOverlays` IR (the `[GfxHouse]` type-4 `GfxOverlay` rows) to the render's
 * per-type animated-state-overlay binding for one tribe: the still `idle` blade and the `working` spin
 * cycle. Shares the bob binding's family rules and the construction reduction's one-source-record stance
 * (lowest `level` group).
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
    // Named limitation: the row's x/y draw offset is not carried into the binding. Every pinned viking
    // overlay row is `0 0`, so the overlay anchors like the body bob; a mod row with a real offset would
    // draw misplaced.
    if (anchor.x !== 0 || anchor.y !== 0) {
      diag.warn(
        'content',
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
