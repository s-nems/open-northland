import type { BuildingOverlayRef } from '@open-northland/render';
import { diag } from '../../diag/index.js';
import type { BuildingOverlayRow } from '../ir/rows.js';
import { type BuildingRefScope, familyLayerFor, rowsByType, skinPalettePool } from './families.js';

/** The source's overlay-state discriminators (`GfxOverlay <sizeIdx> 4 <state> …`). */
const OVERLAY_STATE_IDLE = 0;
const OVERLAY_STATE_WORKING = 1;

/**
 * Reduce the decoded `buildingOverlays` IR (the `[GfxHouse]` type-4 `GfxOverlay` rows) to the render's
 * per-type animated-state-overlay binding for one tribe. Shares the bob binding's family rules and the
 * construction reduction's one-source-record stance, here the lowest `level` group.
 */
export function buildingOverlayRefsByType(
  rows: readonly BuildingOverlayRow[],
  scope: BuildingRefScope,
): Record<number, BuildingOverlayRef> {
  const byType = rowsByType(rows, scope.tribeId);
  const out: Record<number, BuildingOverlayRef> = {};
  for (const [typeId, list] of byType) {
    const pool = skinPalettePool(list, scope.skinSlot);
    const lowestLevel = pool.reduce((lo, r) => Math.min(lo, r.level), Number.POSITIVE_INFINITY);
    const group = pool.filter((r) => r.level === lowestLevel);
    const idleRow = group.find((r) => r.state === OVERLAY_STATE_IDLE);
    const workingRow = group.find((r) => r.state === OVERLAY_STATE_WORKING);
    const anchor = idleRow ?? workingRow;
    if (anchor === undefined) continue;
    // Named limitation: the row's x/y draw offset is not carried into the binding. Every pinned viking
    // overlay row is `0 0`, so a mod row with a real offset would draw misplaced.
    if (anchor.x !== 0 || anchor.y !== 0) {
      diag.warn(
        'content',
        `building overlay type ${typeId}: nonzero offset ${anchor.x},${anchor.y} ignored (not implemented)`,
      );
    }
    const layer = familyLayerFor(anchor.bmd, anchor.paletteName, scope.defaultFamily, scope.families);
    if (layer === null) continue; // family not loaded → no overlay (never a wrong-bob borrow)
    const idle = idleRow?.frames[0];
    const working = workingRow !== undefined && workingRow.frames.length > 0 ? workingRow : undefined;
    if (idle === undefined && working === undefined) continue;
    out[typeId] = {
      ...(layer.layer !== undefined ? { layer: layer.layer } : {}),
      ...(idle !== undefined ? { idle } : {}),
      ...(working !== undefined ? { working: working.frames, ticksPerFrame: working.step } : {}),
    };
  }
  return out;
}
