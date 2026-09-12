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
 * version and the contested key over the band rather than the tick, so a still camera over a running sim
 * re-walks the band only when a blocker changed or a hostile fighter near the screen moved. Fogged nodes
 * dim too, mirroring the `canPlaceAt` fog gate.
 */
export function makeOverlayFrameSource(
  sim: Simulation,
  mapSize: { readonly width: number; readonly height: number },
  // The seat whose fog and enemies gate the overlay.
  player: number = HUMAN_PLAYER,
  tribe?: number,
): (buildingType: number, camera: Camera, screenW: number, screenH: number) => PlacementOverlayFrame | null {
  const band = makeBandProber(sim, mapSize, player);
  return (buildingType, camera, screenW, screenH) =>
    band(
      () => sim.placementProbe(buildingType, player, tribe),
      (probe, band) =>
        `b${buildingType}:${sim.placementBlockerVersion()}:${probe.contestedKeyWithin(band.minCol, band.maxCol, band.minRow, band.maxRow)}`,
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
    band(
      () => sim.signpostProbe(player),
      () => `s:${sim.signpostBlockerVersion()}`,
      camera,
      screenW,
      screenH,
    );
}

interface NodeProbe {
  canPlace(x: number, y: number): boolean;
}

/** Memoizes the whole frame on (probe key, fog, band). The probe is built every frame - the fighter scan
 *  behind it is memoized per world mutation - and its key over the band decides whether to walk again. */
function makeBandProber(
  sim: Simulation,
  mapSize: { readonly width: number; readonly height: number },
  player: number,
): <P extends NodeProbe>(
  probeOf: () => P | null,
  keyOf: (probe: P, band: ReturnType<typeof nodeBandOfCells>) => string,
  camera: Camera,
  screenW: number,
  screenH: number,
) => PlacementOverlayFrame | null {
  let key = '';
  let frame: PlacementOverlayFrame | null = null;
  return (probeOf, keyOf, camera, screenW, screenH) => {
    const probe = probeOf();
    if (probe === null) return null;
    const cells = visibleTileRange(
      cameraViewport(camera, screenW, screenH),
      mapSize.width,
      mapSize.height,
      OVERLAY_BAND_MARGIN,
    );
    const range = nodeBandOfCells(cells);
    const fog = sim.fogView(player);
    const fogKey = fog === null ? 'off' : `${fog.mode}:${fog.generation}`;
    const nextKey = `${keyOf(probe, range)}:${fogKey}:${range.minCol},${range.maxCol},${range.minRow},${range.maxRow}`;
    if (nextKey === key && frame !== null) return frame;
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
