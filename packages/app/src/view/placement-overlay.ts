import { type Camera, cameraViewport, type PlacementOverlayFrame, visibleTileRange } from '@vinland/render';
import { FOG_STATE, type Simulation } from '@vinland/sim';
import { HUMAN_PLAYER } from '../game/rules.js';
import { nodeBandOfCells } from './picking.js';

/** Tiles beyond the visible band the overlay also probes, so its edge never shows during a pan. */
const OVERLAY_BAND_MARGIN = 2;

/**
 * The build-mode overlay-frame builder: the visible band plus which of its HALF-CELL NODES reject
 * the held building's anchor — the SAME rule `placeBuilding` gates on (`Simulation.placementProbe`),
 * so the dimmed area is exactly where a click would be refused (blocked by terrain — trees/stones/
 * ore/water — or by another building's margin). The camera cull yields a CELL band
 * (`visibleTileRange`); the probe walks its 2× node band, since anchors live on the half-cell
 * lattice. Screen-bounded per golden rule 6 (per-frame cost scales with the screen): only the
 * visible band is probed, and only while placing — and the band probe is MEMOIZED on (type,
 * placement-blocker version, band). The version (`Simulation.placementBlockerVersion`) moves only
 * when a building/resource is added or removed, NOT every tick — so a still camera over a RUNNING sim
 * reuses last frame's blocked set instead of re-probing the whole node band per RAF (keying on the
 * tick instead makes the O(4×visible×footprint) loop re-run 20×/s while the game plays). Returns null
 * for a mapless sim (no placement rule → no wash).
 *
 * Under FOG, every node whose cell the player does not currently SEE dims too — the overlay half of
 * the `canPlaceAt` fog gate (the two must never drift), which also stops the probe from leaking
 * fogged occupancy (a blocked-cells pattern inside the black would read as enemy buildings). The
 * memo key carries the fog generation+mode, so a mask rebuild re-probes but a still fog reuses.
 */
export function makeOverlayFrameSource(
  sim: Simulation,
  mapSize: { readonly width: number; readonly height: number },
): (buildingType: number, camera: Camera, screenW: number, screenH: number) => PlacementOverlayFrame | null {
  let key = '';
  let frame: PlacementOverlayFrame | null = null;
  return (buildingType, camera, screenW, screenH) => {
    const cells = visibleTileRange(
      cameraViewport(camera, screenW, screenH),
      mapSize.width,
      mapSize.height,
      OVERLAY_BAND_MARGIN,
    );
    // The node band covering the visible cells.
    const range = nodeBandOfCells(cells);
    const fog = sim.fogView(HUMAN_PLAYER);
    const fogKey = fog === null ? 'off' : `${fog.mode}:${fog.generation}`;
    const nextKey = `${buildingType}:${sim.placementBlockerVersion()}:${fogKey}:${range.minCol},${range.maxCol},${range.minRow},${range.maxRow}`;
    // Nothing that moves the blocked set changed (same type, same blockers, same fog, same camera
    // band): reuse last frame's result and skip both the probe build and the whole-band re-probe.
    if (nextKey === key && frame !== null) return frame;
    const probe = sim.placementProbe(buildingType);
    if (probe === null) return null;
    const blocked: { col: number; row: number }[] = [];
    for (let row = range.minRow; row <= range.maxRow; row++) {
      // A node (col, row) lives in cell (col>>1, row>>1) — `cellOfNode`, inlined in this hot band
      // loop so the per-node test allocates nothing.
      const cellRow = row >> 1;
      for (let col = range.minCol; col <= range.maxCol; col++) {
        const hidden = fog !== null && fog.stateAt(col >> 1, cellRow) !== FOG_STATE.VISIBLE;
        if (hidden || !probe.canPlace(col, row)) blocked.push({ col, row });
      }
    }
    key = nextKey;
    frame = { ...range, blocked };
    return frame;
  };
}
