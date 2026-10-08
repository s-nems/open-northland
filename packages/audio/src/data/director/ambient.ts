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
 * ground fills, and keep the loudest few, holding a playing bed against small changes. A decoded map's two ground triangles per cell join by their
 * own pattern; a grid without them joins by its typeId's representative pattern. Zoom is the engine's:
 * the beds ride the `bed` perspective layer.
 */

/** How many ambient beds may play at once - the loudest few by on-screen coverage. */
export const MAX_AMBIENT_BEDS = 3;
/** Loudest an ambient bed reaches: the wav as recorded, since the beds are mastered far below the
 *  one-shots and the original scales a bed by its coverage alone. Approximation, tune by ear. */
export const AMBIENT_MAX_GAIN = 1;
/** On-screen coverage fraction at which a bed hits {@link AMBIENT_MAX_GAIN} (below it, quieter). */
export const AMBIENT_FULL_COVERAGE = 0.4;
/** A bed outside the playing set takes the slot of the quietest playing one at once only when its
 *  coverage is this many times larger, so a small pan or a zoom's sampling stride does not swap two
 *  beds of near-equal coverage back and forth. Approximation, tune by ear. */
export const BED_SWAP_LEAD = 1.25;
/** Seconds a bed must rank among the loudest few before it takes a playing bed's slot without that lead.
 *  Approximation, tune by ear. */
export const BED_SWAP_HOLD_S = 2;
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

/** One bed's sampled hits on each half of the screen and its share of the explored ground there. */
interface BedCoverage extends SideHits {
  readonly name: string;
  readonly file: string;
  readonly coverage: number;
}

/** One framing's ranked coverage, valid while the viewport, the ground, the sound index and the fog
 *  stand still. */
interface CoverageSample {
  readonly terrain: AudioTerrain;
  readonly index: SoundIndex;
  readonly viewport: Viewport;
  readonly exploredTile: DirectorInput['exploredTile'];
  readonly fogRevision: number | undefined;
  readonly beds: readonly BedCoverage[];
}

/** What the bed choice keeps between frames, held by the caller (the sound driver). */
export class AmbientBedMemory {
  /** The beds the last frame chose. */
  playing: ReadonlySet<string> = new Set();
  /** A bed ranked among the loudest few that is not playing → the audio-clock second it first was. */
  leadingSince: ReadonlyMap<string, number> = new Map();
  /** The last framing's coverage, reused while nothing it depends on moved. */
  sample: CoverageSample | null = null;
}

function sameViewport(a: Viewport, b: Viewport): boolean {
  return a.minX === b.minX && a.maxX === b.maxX && a.minY === b.minY && a.maxY === b.maxY;
}

/**
 * Every bed with a loop on the explored on-screen ground, loudest first. A sample is a ground triangle
 * on a decoded map and a cell otherwise. Ground the viewer never explored is left out of the screen
 * altogether, so a black screen is silent and the explored part alone sets the coverage; explored
 * ground under the grey sounds, as the original gates a sector's beds on whether it was ever discovered.
 */
function sampleCoverage(
  terrain: AudioTerrain,
  vp: Viewport,
  index: SoundIndex,
  exploredTile: DirectorInput['exploredTile'],
): BedCoverage[] {
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
    .flatMap(([name, hits]): BedCoverage[] => {
      const file = index.ambientLoopByName.get(name);
      return file === undefined
        ? []
        : [{ name, file, ...hits, coverage: (hits.left + hits.right) / sampled }];
    })
    .sort((a, b) => b.coverage - a.coverage);
}

/** This frame's ranked coverage, sampled again only when the framing, the ground or the fog moved. A
 *  fog gate without a revision cannot tell, so it samples every frame. */
function rankedBeds(input: DirectorInput): readonly BedCoverage[] {
  const { terrain, camera, canvasW, canvasH, index, exploredTile } = input;
  if (terrain === undefined) return [];
  const viewport = cameraViewport(camera, canvasW, canvasH);
  const memory = input.beds?.memory;
  const fogRevision = input.beds?.fogRevision;
  if (memory === undefined || (exploredTile !== undefined && fogRevision === undefined)) {
    return sampleCoverage(terrain, viewport, index, exploredTile);
  }
  const held = memory.sample;
  if (
    held !== null &&
    held.terrain === terrain &&
    held.index === index &&
    held.exploredTile === exploredTile &&
    held.fogRevision === fogRevision &&
    sameViewport(held.viewport, viewport)
  ) {
    return held.beds;
  }
  const beds = sampleCoverage(terrain, viewport, index, exploredTile);
  memory.sample = { terrain, index, viewport, exploredTile, fogRevision, beds };
  return beds;
}

/**
 * The loudest few beds with hysteresis: a playing bed still on screen keeps its slot until a bed ranked
 * above it leads it by {@link BED_SWAP_LEAD}, or has ranked among the loudest few for
 * {@link BED_SWAP_HOLD_S}. A free slot fills at once.
 */
function holdBeds(ranked: readonly BedCoverage[], memory: AmbientBedMemory, now: number): BedCoverage[] {
  const top = ranked.slice(0, MAX_AMBIENT_BEDS);
  const kept = ranked.filter((bed) => memory.playing.has(bed.name));
  const keptNames = new Set(kept.map((bed) => bed.name));
  const leading = new Map<string, number>();
  for (const challenger of top) {
    if (keptNames.has(challenger.name)) continue;
    if (kept.length < MAX_AMBIENT_BEDS) {
      kept.push(challenger);
      keptNames.add(challenger.name);
      continue;
    }
    // A full set holds the challenger out of the top few, so a kept bed ranks below it.
    const incumbent = kept.reduce<BedCoverage | undefined>(
      (low, bed) => (!top.includes(bed) && (low === undefined || bed.coverage < low.coverage) ? bed : low),
      undefined,
    );
    const since = memory.leadingSince.get(challenger.name) ?? now;
    if (
      incumbent !== undefined &&
      (challenger.coverage >= incumbent.coverage * BED_SWAP_LEAD || now - since >= BED_SWAP_HOLD_S)
    ) {
      keptNames.delete(incumbent.name);
      keptNames.add(challenger.name);
      kept[kept.indexOf(incumbent)] = challenger;
    } else {
      leading.set(challenger.name, since);
    }
  }
  memory.playing = keptNames;
  memory.leadingSince = leading;
  return kept.sort((a, b) => b.coverage - a.coverage);
}

/**
 * The ambient beds active this frame: the loudest few by explored on-screen coverage
 * ({@link sampleCoverage}), each at a coverage-weighted gain and panned toward the half of the screen
 * its ground fills. With the caller's memory the set holds against small changes ({@link holdBeds});
 * without it, the loudest few as they rank this frame.
 */
export function ambientBeds(input: DirectorInput): AmbientLoop[] {
  const ranked = rankedBeds(input);
  const beds = input.beds;
  const chosen =
    beds === undefined ? ranked.slice(0, MAX_AMBIENT_BEDS) : holdBeds(ranked, beds.memory, beds.now);
  return chosen.map(({ name, file, left, right, coverage }) => ({
    name,
    file,
    gain: AMBIENT_MAX_GAIN * clamp(Math.sqrt(coverage) / Math.sqrt(AMBIENT_FULL_COVERAGE), 0, 1),
    pan: (AMBIENT_MAX_PAN * (right - left)) / (right + left),
  }));
}
