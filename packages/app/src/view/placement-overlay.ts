import {
  type Camera,
  cameraViewport,
  type PlacementOverlayFrame,
  visibleTileRange,
} from '@open-northland/render';
import { type Entity, FOG_STATE, type Paper, type Simulation } from '@open-northland/sim';
import { HUMAN_PLAYER } from '../game/rules.js';
import { type ActiveLine, type LineFan, lineFan, lineReach } from '../hud/tool-panel/line-tool.js';
import type { LitNodes } from '../hud/tool-panel/placement.js';
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
): (
  buildingType: number,
  camera: Camera,
  screenW: number,
  screenH: number,
  paper?: Paper,
) => PlacementOverlayFrame | null {
  const band = makeBandProber(sim, mapSize, player);
  return (buildingType, camera, screenW, screenH, paper) =>
    band(
      () => sim.placementProbe(buildingType, player, paper === undefined ? tribe : undefined),
      (probe, band) =>
        `b${buildingType}:${paper === undefined ? 'tech' : 'paper'}:${sim.placementBlockerVersion()}:${probe.contestedKeyWithin(band.minCol, band.maxCol, band.minRow, band.maxRow)}`,
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

/**
 * A started line's lit nodes (`lineReach`): exactly where a confirming click lays the whole line. The
 * lines themselves are walked once per anchor; the nodes are re-probed only when the tool, a placement
 * blocker or the fog changes.
 */
export function makeLineReachSource(
  sim: Simulation,
  player: number = HUMAN_PLAYER,
): (line: ActiveLine) => LitNodes {
  let lit: LitNodes = { key: '', has: () => false };
  let fan: LineFan | null = null;
  return (line) => {
    const fog = sim.fogView(player);
    const key = `line:${line.tool}:${line.anchor.col},${line.anchor.row}:${sim.placementBlockerVersion()}:${fog === null ? 'off' : `${fog.mode}:${fog.generation}`}`;
    if (key !== lit.key) {
      if (
        fan === null ||
        fan.anchor.col !== line.anchor.col ||
        fan.anchor.row !== line.anchor.row ||
        fan.maxEdges !== line.maxEdges
      ) {
        fan = lineFan(line.anchor, line.maxEdges);
      }
      const reach = lineReach(line, fan);
      lit = { key, has: (col, row) => reach.has(`${col},${row}`) };
    }
    return lit;
  };
}

/** The wash of a tool that lights a node set of its own: everything dims but `lit`. */
export function makeLitOverlaySource(
  sim: Simulation,
  mapSize: { readonly width: number; readonly height: number },
  player: number = HUMAN_PLAYER,
): (lit: LitNodes, camera: Camera, screenW: number, screenH: number) => PlacementOverlayFrame | null {
  const band = makeBandProber(sim, mapSize, player);
  return (lit, camera, screenW, screenH) =>
    band(
      () => ({ canPlace: (x: number, y: number) => lit.has(x, y) }),
      () => lit.key,
      camera,
      screenW,
      screenH,
    );
}

/**
 * The dock-pick twin of {@link makeSignpostOverlaySource}: the shore a ship's dock order would moor at,
 * lit, and the rest of the band dimmed. Memoized on the sim's mooring probe key, which changes with the
 * ship's position and the walk-blockers, so an armed pick over a still sea re-walks nothing.
 */
export function makeDockOverlaySource(
  sim: Simulation,
  mapSize: { readonly width: number; readonly height: number },
  player: number = HUMAN_PLAYER,
): (vehicle: number, camera: Camera, screenW: number, screenH: number) => PlacementOverlayFrame | null {
  const band = makeBandProber(sim, mapSize, player);
  return (vehicle, camera, screenW, screenH) =>
    band(
      () => {
        const probe = sim.mooringProbe(vehicle as Entity);
        return probe === null ? null : { canPlace: probe.canMoor, key: probe.key };
      },
      (probe) => `d${vehicle}:${probe.key}`,
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
