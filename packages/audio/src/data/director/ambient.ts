import { aabbIntersects, cameraViewport, tileToScreen, visibleTileRange } from '@open-northland/render/data';
import { clamp } from '../math.js';
import type { AmbientLoop, DirectorInput } from '../types.js';

/**
 * On-screen terrain → ambient beds: sample the visible tile band (strided so a zoomed-out whole-map
 * view stays bounded), weight each bed by its screen coverage, pan it toward the half of the screen its
 * terrain fills, and keep the loudest few. Zoom is the engine's: the beds ride the `bed` perspective
 * layer.
 */

/** How many ambient beds may play at once - the loudest few by on-screen coverage. */
export const MAX_AMBIENT_BEDS = 3;
/** Loudest an ambient bed reaches. */
export const AMBIENT_MAX_GAIN = 0.5;
/** On-screen coverage fraction at which a bed hits {@link AMBIENT_MAX_GAIN} (below it, quieter). */
export const AMBIENT_FULL_COVERAGE = 0.4;
/** Cap on tiles sampled per frame for ambient - a stride keeps a zoomed-out whole-map view bounded. */
export const AMBIENT_MAX_SAMPLES = 4096;
/** Pan of a bed whose terrain fills only one half of the screen; a bed on both halves sits between by
 *  their balance. Below the point-sound pan since a bed is a wide area, not a spot. Approximation: the
 *  original plays its beds centred. */
export const AMBIENT_MAX_PAN = 0.6;

/** Pre-camera screen x one column step moves a tile, the same on every row. */
const COLUMN_STEP_X = tileToScreen(1, 0).x - tileToScreen(0, 0).x;

/** One bed's sampled hits on each half of the screen. */
interface SideHits {
  left: number;
  right: number;
}

/**
 * The ambient beds active this frame, by sampling the on-screen terrain tiles (coverage-weighted gain,
 * side-weighted pan). A tile hidden by the viewer's fog counts toward the screen but sounds no bed, so a
 * black screen is silent. Approximation: the original gates a sector on whether it was ever discovered;
 * the director only knows current visibility.
 */
export function ambientBeds(input: DirectorInput): AmbientLoop[] {
  const { terrain, camera, canvasW, canvasH, index, visibleTile } = input;
  if (terrain === undefined || terrain.width <= 0 || terrain.height <= 0) return [];
  const vp = cameraViewport(camera, canvasW, canvasH);
  // The map's projected world-space bounds: its four corner tiles. When the camera frames only empty
  // space beyond the grid, the viewport doesn't overlap this box, so no terrain is on screen and no
  // ambient should play - `visibleTileRange`'s clamp would otherwise collapse to a phantom edge tile.
  const c0 = tileToScreen(0, 0);
  const c1 = tileToScreen(terrain.width - 1, 0);
  const c2 = tileToScreen(0, terrain.height - 1);
  const c3 = tileToScreen(terrain.width - 1, terrain.height - 1);
  const mapBox = {
    minX: Math.min(c0.x, c1.x, c2.x, c3.x),
    maxX: Math.max(c0.x, c1.x, c2.x, c3.x),
    minY: Math.min(c0.y, c1.y, c2.y, c3.y),
    maxY: Math.max(c0.y, c1.y, c2.y, c3.y),
  };
  if (!aabbIntersects(vp, mapBox)) return [];
  const band = visibleTileRange(vp, terrain.width, terrain.height);
  const cols = band.maxCol - band.minCol + 1;
  const rows = band.maxRow - band.minRow + 1;
  if (cols <= 0 || rows <= 0) return [];
  const stride = Math.max(1, Math.ceil(Math.sqrt((cols * rows) / AMBIENT_MAX_SAMPLES)));
  // The pre-camera x under the screen centre splits each row into its left and right halves.
  const centreX = (vp.minX + vp.maxX) / 2;
  const counts = new Map<string, SideHits>();
  let sampled = 0;
  for (let row = band.minRow; row <= band.maxRow; row += stride) {
    const splitCol = (centreX - tileToScreen(0, row).x) / COLUMN_STEP_X;
    for (let col = band.minCol; col <= band.maxCol; col += stride) {
      const typeId = terrain.typeIds[row * terrain.width + col];
      if (typeId === undefined) continue; // out-of-range (malformed grid): don't dilute the coverage denominator
      sampled++;
      if (visibleTile !== undefined && !visibleTile(col, row)) continue;
      const beds = index.ambientByTerrainType.get(typeId);
      if (beds === undefined) continue;
      for (const bed of beds) {
        let hits = counts.get(bed);
        if (hits === undefined) {
          hits = { left: 0, right: 0 };
          counts.set(bed, hits);
        }
        if (col < splitCol) hits.left++;
        else hits.right++;
      }
    }
  }
  if (sampled === 0) return [];
  return [...counts.entries()]
    .map(([name, hits]) => ({ name, hits, coverage: (hits.left + hits.right) / sampled }))
    .sort((a, b) => b.coverage - a.coverage)
    .slice(0, MAX_AMBIENT_BEDS)
    .flatMap(({ name, hits, coverage }): AmbientLoop[] => {
      const file = index.ambientLoopByName.get(name);
      if (file === undefined) return [];
      const gain = AMBIENT_MAX_GAIN * clamp(Math.sqrt(coverage) / Math.sqrt(AMBIENT_FULL_COVERAGE), 0, 1);
      const pan = (AMBIENT_MAX_PAN * (hits.right - hits.left)) / (hits.right + hits.left);
      return [{ name, file, gain, pan }];
    });
}
