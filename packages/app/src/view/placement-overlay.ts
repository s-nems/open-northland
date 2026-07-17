import {
  type Camera,
  cameraViewport,
  type PlacementOverlayFrame,
  visibleTileRange,
} from '@open-northland/render';
import { FOG_STATE, type Simulation } from '@open-northland/sim';
import { HUMAN_PLAYER } from '../game/rules.js';
import { nodeBandOfCells } from './picking.js';

/** Tiles beyond the visible band the overlay also probes, so its edge never shows during a pan. */
const OVERLAY_BAND_MARGIN = 2;

/**
 * The build-mode overlay-frame builder: the visible band plus which of its half-cell nodes reject the
 * held building's anchor — the same rule `placeBuilding` gates on (`Simulation.placementProbe`), so the
 * dimmed area is exactly where a click would be refused (blocked by terrain — trees/stones/ore/water — or
 * by another building's margin). The camera cull yields a cell band (`visibleTileRange`); the probe walks
 * its 2× node band, since anchors live on the half-cell lattice. Screen-bounded per golden rule 6: only the
 * visible band is probed, only while placing, and the probe is memoized on (type, placement-blocker
 * version, band). The version (`Simulation.placementBlockerVersion`) moves only when a building/resource is
 * added or removed, not every tick — so a still camera over a running sim reuses last frame's blocked set
 * instead of re-probing the whole node band per RAF (keying on the tick would re-run the
 * O(4×visible×footprint) loop 20×/s while the game plays). Returns null for a mapless sim.
 *
 * Under fog, every node whose cell the player does not currently see dims too — the overlay half of the
 * `canPlaceAt` fog gate (the two must never drift), which also stops the probe from leaking fogged
 * occupancy (a blocked-cells pattern inside the black would read as enemy buildings). The memo key carries
 * the fog generation+mode, so a mask rebuild re-probes but a still fog reuses.
 */
export function makeOverlayFrameSource(
  sim: Simulation,
  mapSize: { readonly width: number; readonly height: number },
  // The viewing player whose fog gates the overlay (the menu's roster pick; default for scenes).
  player: number = HUMAN_PLAYER,
): (buildingType: number, camera: Camera, screenW: number, screenH: number) => PlacementOverlayFrame | null {
  const band = makeBandProber(sim, mapSize, player);
  return (buildingType, camera, screenW, screenH) =>
    band(
      `b${buildingType}:${sim.placementBlockerVersion()}`,
      () => sim.placementProbe(buildingType),
      camera,
      screenW,
      screenH,
    );
}

/**
 * The erect-signpost twin of {@link makeOverlayFrameSource}: the dimmed area is exactly where the
 * scout's placement click would be refused (`Simulation.signpostProbe` — occupied ground or inside an
 * own signpost's minimum-spacing circle). Same band cull, fog gate, and memo discipline; the memo keys
 * on `signpostBlockerVersion`, which also tracks the work-flag markers buildings ignore.
 */
export function makeSignpostOverlaySource(
  sim: Simulation,
  mapSize: { readonly width: number; readonly height: number },
  player: number = HUMAN_PLAYER,
): (camera: Camera, screenW: number, screenH: number) => PlacementOverlayFrame | null {
  const band = makeBandProber(sim, mapSize, player);
  return (camera, screenW, screenH) =>
    band(`s:${sim.signpostBlockerVersion()}`, () => sim.signpostProbe(player), camera, screenW, screenH);
}

/** A per-node placement test with a `canPlace(col,row)` face — what both overlay probes resolve to. */
interface NodeProbe {
  canPlace(x: number, y: number): boolean;
}

/** The shared band walk both frame sources close over: cull to the visible node band, drop fogged or
 *  probe-rejected nodes into `blocked`, memoize the whole frame on (probe key, fog, band). */
function makeBandProber(
  sim: Simulation,
  mapSize: { readonly width: number; readonly height: number },
  player: number,
): (
  probeKey: string,
  probeOf: () => NodeProbe | null,
  camera: Camera,
  screenW: number,
  screenH: number,
) => PlacementOverlayFrame | null {
  let key = '';
  let frame: PlacementOverlayFrame | null = null;
  return (probeKey, probeOf, camera, screenW, screenH) => {
    const cells = visibleTileRange(
      cameraViewport(camera, screenW, screenH),
      mapSize.width,
      mapSize.height,
      OVERLAY_BAND_MARGIN,
    );
    // The node band covering the visible cells.
    const range = nodeBandOfCells(cells);
    const fog = sim.fogView(player);
    const fogKey = fog === null ? 'off' : `${fog.mode}:${fog.generation}`;
    const nextKey = `${probeKey}:${fogKey}:${range.minCol},${range.maxCol},${range.minRow},${range.maxRow}`;
    // Nothing that moves the blocked set changed (same probe inputs, same fog, same camera band):
    // reuse last frame's result and skip both the probe build and the whole-band re-probe.
    if (nextKey === key && frame !== null) return frame;
    const probe = probeOf();
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
