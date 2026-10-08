import {
  aabbIntersects,
  cameraViewport,
  type TileRange,
  tileToScreen,
  type Viewport,
  visibleTileRange,
} from '@open-northland/render/data';
import type { SoundIndex } from '../bank.js';
import { clamp } from '../math.js';
import type { AmbientLoop, AudioTerrain, DirectorInput } from '../types.js';

/**
 * On-screen ground → ambient beds: sample the visible tile band (strided so a zoomed-out whole-map
 * view stays bounded), weight each bed by its screen coverage, pan it toward the half of the screen its
 * ground fills, and keep the loudest few. A decoded map's two ground triangles per cell join by their
 * own pattern; a grid without them joins by its typeId's representative pattern. Zoom is the engine's:
 * the beds ride the `bed` perspective layer.
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

/** A map's ground pattern slot → its beds, per sound index: built once per map, read per sample. */
const groundBedsCache = new WeakMap<
  readonly string[],
  { readonly index: SoundIndex; readonly beds: readonly (readonly string[] | undefined)[] }
>();

function groundSlotBeds(
  patterns: readonly string[],
  index: SoundIndex,
): readonly (readonly string[] | undefined)[] {
  const cached = groundBedsCache.get(patterns);
  if (cached?.index === index) return cached.beds;
  const beds = patterns.map((name) => index.ambientByGroundPattern.get(name));
  groundBedsCache.set(patterns, { index, beds });
  return beds;
}

/**
 * The tile band the viewport frames over the map, or null when it frames only empty space beyond the
 * grid: `visibleTileRange`'s clamp would otherwise collapse to a phantom edge tile.
 */
export function onScreenTiles(
  terrain: Pick<AudioTerrain, 'width' | 'height'>,
  vp: Viewport,
): TileRange | null {
  if (terrain.width <= 0 || terrain.height <= 0) return null;
  // The map's projected world-space bounds: its four corner tiles.
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
  if (!aabbIntersects(vp, mapBox)) return null;
  const band = visibleTileRange(vp, terrain.width, terrain.height);
  return band.maxCol < band.minCol || band.maxRow < band.minRow ? null : band;
}

/**
 * The ambient beds active this frame, by sampling the on-screen ground (coverage-weighted gain,
 * side-weighted pan). A sample is a ground triangle on a decoded map and a cell otherwise. Ground the
 * viewer never explored is left out of the screen altogether, so a black screen is silent and the
 * explored part alone sets the coverage; explored ground under the grey sounds, as the original gates a
 * sector's beds on whether it was ever discovered.
 */
export function ambientBeds(input: DirectorInput): AmbientLoop[] {
  const { terrain, camera, canvasW, canvasH, index, exploredTile } = input;
  if (terrain === undefined) return [];
  const vp = cameraViewport(camera, canvasW, canvasH);
  const band = onScreenTiles(terrain, vp);
  if (band === null) return [];
  const cols = band.maxCol - band.minCol + 1;
  const rows = band.maxRow - band.minRow + 1;
  const stride = Math.max(1, Math.ceil(Math.sqrt((cols * rows) / AMBIENT_MAX_SAMPLES)));
  // The pre-camera x under the screen centre splits each row into its left and right halves.
  const centreX = (vp.minX + vp.maxX) / 2;
  const { ground } = terrain;
  const slotBeds = ground === undefined ? undefined : groundSlotBeds(ground.patterns, index);
  const counts = new Map<string, SideHits>();
  let sampled = 0;
  const tally = (beds: readonly string[] | undefined, left: boolean): void => {
    sampled++;
    if (beds === undefined) return;
    for (const bed of beds) {
      let hits = counts.get(bed);
      if (hits === undefined) {
        hits = { left: 0, right: 0 };
        counts.set(bed, hits);
      }
      if (left) hits.left++;
      else hits.right++;
    }
  };
  for (let row = band.minRow; row <= band.maxRow; row += stride) {
    const splitCol = (centreX - tileToScreen(0, row).x) / COLUMN_STEP_X;
    for (let col = band.minCol; col <= band.maxCol; col += stride) {
      if (exploredTile !== undefined && !exploredTile(col, row)) continue;
      const cell = row * terrain.width + col;
      const left = col < splitCol;
      // A slot outside the pattern list or a cell outside the grid (a malformed map) is skipped, not
      // counted, so it can't dilute the coverage; ground with no bed of its own does count.
      if (ground !== undefined && slotBeds !== undefined) {
        const a = ground.a[cell];
        const b = ground.b[cell];
        if (a !== undefined && a < slotBeds.length) tally(slotBeds[a], left);
        if (b !== undefined && b < slotBeds.length) tally(slotBeds[b], left);
      } else {
        const typeId = terrain.typeIds[cell];
        if (typeId !== undefined) tally(index.ambientByTerrainType.get(typeId), left);
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
