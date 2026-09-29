import {
  type Camera,
  cameraViewport,
  type PlacementOverlayFrame,
  visibleTileRange,
} from '@open-northland/render';
import { FOG_STATE, type NodeGridAnswer, nodeGridAccepts, type Paper } from '@open-northland/sim';
import { HUMAN_PLAYER } from '../game/rules.js';
import type { LitNodes } from '../hud/tool-panel/line-tool.js';
import { type NodeGridProbe, PROBE_AREA_NODES, type SessionHost } from '../session/index.js';
import { nodeBandOfCells } from './picking.js';
import type { PlacementProbeViews } from './runtime/placement-gates.js';

/** Tiles beyond the visible band the overlay also probes, so its edge never shows during a pan. */
const OVERLAY_BAND_MARGIN = 2;

/**
 * Build-mode overlay frame: the visible node band plus the nodes where `placeBuilding` would refuse the
 * held building, so the dimmed area matches the click rule exactly. Memoized on the host's answer keys
 * over the band, which change when a blocker, the seat's technology or a hostile fighter near the screen
 * does, so a still camera over a running sim re-walks the band only then. Fogged nodes dim too,
 * mirroring the `canPlaceAt` fog gate.
 */
export function makeOverlayFrameSource(
  probes: Pick<PlacementProbeViews, 'building'>,
  host: Pick<SessionHost, 'fogView'>,
  mapSize: { readonly width: number; readonly height: number },
  // The seat whose fog and enemies gate the overlay.
  player: number = HUMAN_PLAYER,
): (
  buildingType: number,
  camera: Camera,
  screenW: number,
  screenH: number,
  paper?: Paper,
) => PlacementOverlayFrame | null {
  const band = makeBandProber(host, mapSize, player);
  return (buildingType, camera, screenW, screenH, paper) => {
    const probe = probes.building(buildingType, paper);
    return band(
      gridBandProbe(probe, `b${buildingType}:${paper === undefined ? 'tech' : 'paper'}`),
      camera,
      screenW,
      screenH,
    );
  };
}

/** The erect-signpost twin of {@link makeOverlayFrameSource}, whose answers also track the work-flag
 *  markers buildings ignore. */
export function makeSignpostOverlaySource(
  probes: Pick<PlacementProbeViews, 'signpost'>,
  host: Pick<SessionHost, 'fogView'>,
  mapSize: { readonly width: number; readonly height: number },
  player: number = HUMAN_PLAYER,
): (camera: Camera, screenW: number, screenH: number) => PlacementOverlayFrame | null {
  const band = makeBandProber(host, mapSize, player);
  return (camera, screenW, screenH) => band(gridBandProbe(probes.signpost(), 's'), camera, screenW, screenH);
}

/** The line tool whose placement answers a lit set reads: the road tool's, or a wall graphics row's. */
export type LitAnswers = { readonly tool: 'road' } | { readonly tool: 'palisade'; readonly gfxIndex: number };

/**
 * The wash of a tool that lights a node set of its own: everything dims but `lit`. A set read from a line
 * tool's `answers` refuses every node whose area is still being answered, so, like the grid washes, it
 * shows nothing until an answer over the band lands; otherwise the tool's first frame dims the whole view.
 */
export function makeLitOverlaySource(
  probes: Pick<PlacementProbeViews, 'road' | 'palisade'>,
  host: Pick<SessionHost, 'fogView'>,
  mapSize: { readonly width: number; readonly height: number },
  player: number = HUMAN_PLAYER,
): (
  lit: LitNodes,
  answers: LitAnswers | null,
  camera: Camera,
  screenW: number,
  screenH: number,
) => PlacementOverlayFrame | null {
  const band = makeBandProber(host, mapSize, player);
  return (lit, answers, camera, screenW, screenH) => {
    const probe =
      answers === null ? null : answers.tool === 'road' ? probes.road() : probes.palisade(answers.gfxIndex);
    const keyWithin = (range: NodeBand): string | null =>
      probe === null || probe.keyWithin(range.minCol, range.maxCol, range.minRow, range.maxRow) !== null
        ? lit.key
        : null;
    return band({ keyWithin, accepts: () => lit.has }, camera, screenW, screenH);
  };
}

/**
 * The dock-pick twin of {@link makeSignpostOverlaySource}: the shore a ship's dock order would moor at,
 * lit, and the rest of the band dimmed. Memoized on the sim's mooring probe key, which changes with the
 * ship's position and the walk-blockers, so an armed pick over a still sea re-walks nothing.
 */
export function makeDockOverlaySource(
  probes: Pick<PlacementProbeViews, 'mooring'>,
  host: Pick<SessionHost, 'fogView'>,
  mapSize: { readonly width: number; readonly height: number },
  player: number = HUMAN_PLAYER,
): (vehicle: number, camera: Camera, screenW: number, screenH: number) => PlacementOverlayFrame | null {
  const band = makeBandProber(host, mapSize, player);
  return (vehicle, camera, screenW, screenH) => {
    const probe = probes.mooring(vehicle);
    if (probe === null || probe === undefined) return null;
    return band(
      { keyWithin: () => `d${vehicle}:${probe.key}`, accepts: () => probe.canMoor },
      camera,
      screenW,
      screenH,
    );
  };
}

type NodeBand = ReturnType<typeof nodeBandOfCells>;

/** What the band walk asks of a rule: a key over the band, null for no overlay at all, and a node test
 *  made once per walk. */
interface BandProbe {
  keyWithin(band: NodeBand): string | null;
  accepts(): (x: number, y: number) => boolean;
}

/** A grid probe as the band walk reads it: no overlay until an answer over the band lands or when the
 *  host has no such probe, and a node whose area is still being answered dims. */
function gridBandProbe(probe: NodeGridProbe, prefix: string): BandProbe {
  return {
    keyWithin: (band) => {
      const key = probe.keyWithin(band.minCol, band.maxCol, band.minRow, band.maxRow);
      return key === null ? null : `${prefix}:${key}`;
    },
    accepts: () => {
      // The walk runs row by row, so the answer is looked up once per area crossed rather than per node.
      let areaX = Number.NaN;
      let areaY = Number.NaN;
      let answer: NodeGridAnswer | null | undefined;
      return (x, y) => {
        const ax = Math.floor(x / PROBE_AREA_NODES);
        const ay = Math.floor(y / PROBE_AREA_NODES);
        if (ax !== areaX || ay !== areaY) {
          answer = probe.answerAt(x, y);
          areaX = ax;
          areaY = ay;
        }
        return answer !== null && answer !== undefined && nodeGridAccepts(answer, x, y);
      };
    },
  };
}

/** Memoizes the whole frame on (probe key, fog, band); the key over the band decides whether to walk
 *  again. */
function makeBandProber(
  host: Pick<SessionHost, 'fogView'>,
  mapSize: { readonly width: number; readonly height: number },
  player: number,
): (probe: BandProbe, camera: Camera, screenW: number, screenH: number) => PlacementOverlayFrame | null {
  let key = '';
  let frame: PlacementOverlayFrame | null = null;
  return (probe, camera, screenW, screenH) => {
    const cells = visibleTileRange(
      cameraViewport(camera, screenW, screenH),
      mapSize.width,
      mapSize.height,
      OVERLAY_BAND_MARGIN,
    );
    const range = nodeBandOfCells(cells);
    const probeKey = probe.keyWithin(range);
    if (probeKey === null) return null;
    const fog = host.fogView(player);
    const fogKey = fog === null ? 'off' : `${fog.mode}:${fog.generation}`;
    const nextKey = `${probeKey}:${fogKey}:${range.minCol},${range.maxCol},${range.minRow},${range.maxRow}`;
    if (nextKey === key && frame !== null) return frame;
    const accepts = probe.accepts();
    const blocked: { col: number; row: number }[] = [];
    for (let row = range.minRow; row <= range.maxRow; row++) {
      // Node (col, row) lives in cell (col>>1, row>>1); `cellOfNode` is inlined to keep this band
      // loop allocation-free.
      const cellRow = row >> 1;
      for (let col = range.minCol; col <= range.maxCol; col++) {
        const hidden = fog !== null && fog.stateAt(col >> 1, cellRow) !== FOG_STATE.VISIBLE;
        if (hidden || !accepts(col, row)) blocked.push({ col, row });
      }
    }
    key = nextKey;
    frame = { ...range, blocked };
    return frame;
  };
}
