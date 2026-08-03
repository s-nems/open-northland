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
 * Build-mode overlay frame: the visible node band plus the nodes where `placeBuilding` would refuse the
 * held building, so the dimmed area matches the click rule exactly. Memoized on the placement-blocker
 * version rather than the tick, so a still camera over a running sim does not re-probe the band. Fogged
 * nodes dim too, mirroring the `canPlaceAt` fog gate.
 */
export function makeOverlayFrameSource(
  sim: Simulation,
  mapSize: { readonly width: number; readonly height: number },
  // The viewing player whose fog gates the overlay.
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
 * The erect-signpost twin of {@link makeOverlayFrameSource}, memoized on `signpostBlockerVersion`,
 * which also tracks the work-flag markers buildings ignore.
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

interface NodeProbe {
  canPlace(x: number, y: number): boolean;
}

/** Memoizes the whole frame on (probe key, fog, band). */
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
    const range = nodeBandOfCells(cells);
    const fog = sim.fogView(player);
    const fogKey = fog === null ? 'off' : `${fog.mode}:${fog.generation}`;
    const nextKey = `${probeKey}:${fogKey}:${range.minCol},${range.maxCol},${range.minRow},${range.maxRow}`;
    if (nextKey === key && frame !== null) return frame;
    const probe = probeOf();
    if (probe === null) return null;
    const blocked: { col: number; row: number }[] = [];
    for (let row = range.minRow; row <= range.maxRow; row++) {
      // Node (col, row) lives in cell (col>>1, row>>1); `cellOfNode` is inlined to keep this band
      // loop allocation-free.
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
