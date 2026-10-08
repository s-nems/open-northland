import { cameraViewport, type TileRange } from '@open-northland/render/data';
import { type LandscapeAmbience, type LandscapeSoundPool, poolGain, type SoundIndex } from '../bank.js';
import {
  LANDSCAPE_SECTOR_TILES,
  type LandscapeSectors,
  landscapeSectorsOf,
  sectorKey,
} from '../landscape-sectors.js';
import { NEAR_ZOOM_SCALE } from '../perspective.js';
import type { TilePoint } from '../snapshot.js';
import { computeSpatial } from '../spatial.js';
import type { DirectorInput, Lane, OneShot } from '../types.js';
import { onScreenTiles } from './ambient.js';

/**
 * Landscape objects on screen → their ambience one-shots: birds in a tree, a branch cracking under
 * snow, a stone settling. Each game tick every ambience the screen shows rolls once, at the original's
 * rate, and sounds at one of its objects picked at random, so a bird sings from a tree on screen.
 */

/**
 * The range a landscape ambience's chance rolls in. Original behavior, unconfirmed in play: each tick,
 * per sector and ambience, the original picks a wav by weight and fires it when `rand() % 10000` is
 * below the sector's object count times that wav's chance. The director sums the visible sectors
 * instead, which keeps the expected rate (no sector holds enough objects to saturate its roll).
 */
export const LANDSCAPE_CHANCE_RANGE = 10_000;

/** Game ticks one frame rolls the object ambience for at most; a longer frame drops the surplus
 *  rather than bursting it. */
export const MAX_LANDSCAPE_TICKS_PER_FRAME = 5;

const SFX_LANE: Lane = { kind: 'sfx' };

/** One ambience's objects on screen: how many, and the per-sector lists to pick one from. */
interface AmbienceTally {
  readonly ambience: LandscapeAmbience;
  count: number;
  readonly holders: ReadonlyMap<number, TilePoint>[];
}

/** The tally of one framing of the map, valid while the sector band and both sources stand still. */
interface ScreenTally {
  readonly band: TileRange;
  readonly liveRevision: number;
  readonly scenery: LandscapeSectors | undefined;
  readonly groups: readonly AmbienceTally[];
}

/** The last tally per live sector index: a camera that stays inside one sector band, over objects
 *  nobody felled, reuses it. */
const tallies = new WeakMap<LandscapeSectors, ScreenTally>();

/** The sector band covering a tile band. */
function sectorBand(tiles: TileRange): TileRange {
  return {
    minCol: Math.floor(tiles.minCol / LANDSCAPE_SECTOR_TILES),
    maxCol: Math.floor(tiles.maxCol / LANDSCAPE_SECTOR_TILES),
    minRow: Math.floor(tiles.minRow / LANDSCAPE_SECTOR_TILES),
    maxRow: Math.floor(tiles.maxRow / LANDSCAPE_SECTOR_TILES),
  };
}

function sameBand(a: TileRange, b: TileRange): boolean {
  return a.minCol === b.minCol && a.maxCol === b.maxCol && a.minRow === b.minRow && a.maxRow === b.maxRow;
}

/** Count each ambience's objects over the sector band: work per visible sector and record, never per
 *  object. */
function tallyBand(
  band: TileRange,
  sources: readonly LandscapeSectors[],
  index: SoundIndex,
): AmbienceTally[] {
  const byAmbience = new Map<LandscapeAmbience, AmbienceTally>();
  for (let row = band.minRow; row <= band.maxRow; row++) {
    for (let col = band.minCol; col <= band.maxCol; col++) {
      const key = sectorKey(col, row);
      for (const source of sources) {
        const sector = source.sectors.get(key);
        if (sector === undefined) continue;
        for (const [record, objects] of sector) {
          const ambience = index.landscapeAmbienceByRecord.get(record);
          if (ambience === undefined) continue;
          let tally = byAmbience.get(ambience);
          if (tally === undefined) {
            tally = { ambience, count: 0, holders: [] };
            byAmbience.set(ambience, tally);
          }
          tally.count += objects.size;
          tally.holders.push(objects);
        }
      }
    }
  }
  return [...byAmbience.values()];
}

/** The pool a `[0,1)` roll picks by weight. */
function pickPool(ambience: LandscapeAmbience, roll: number): LandscapeSoundPool | undefined {
  let left = roll * ambience.weight;
  for (const pool of ambience.pools) {
    if (left < pool.weight) return pool;
    left -= pool.weight;
  }
  return ambience.pools.at(-1);
}

/** The object a `[0,1)` roll picks among the tally's, each equally likely. */
function pickObject(tally: AmbienceTally, roll: number): TilePoint | undefined {
  let left = Math.floor(roll * tally.count);
  for (const objects of tally.holders) {
    if (left >= objects.size) {
      left -= objects.size;
      continue;
    }
    for (const tile of objects.values()) if (left-- === 0) return tile;
  }
  return undefined;
}

/**
 * The share of the original's rate a zoomed-out screen rolls at. The original has no zoom, so its rate
 * is a 1:1 screen's: a wider view keeps that density instead of multiplying the one-shots by the area
 * it adds. Approximation.
 */
function zoomDensity(scale: number | undefined): number {
  const s = scale === undefined || !(scale > 0) ? NEAR_ZOOM_SCALE : scale;
  return Math.min(1, s / NEAR_ZOOM_SCALE) ** 2;
}

/**
 * This frame's landscape ambience one-shots: per elapsed tick and per ambience on screen, one weighted
 * pool pick and one roll against the screen's object count times the pool's chance. A hit sounds at a
 * random object of the ambience, at the pool's authored volume and the object's screen position; one
 * hidden by the viewer's fog stays silent, as the beds do.
 */
export function objectAmbienceShots(input: DirectorInput): OneShot[] {
  const { landscape, terrain, camera, canvasW, canvasH, index, visibleTile, snapshot } = input;
  if (landscape === undefined || terrain === undefined || index.landscapeAmbienceByRecord.size === 0)
    return [];
  const ticks = Math.min(landscape.ticks, MAX_LANDSCAPE_TICKS_PER_FRAME);
  if (ticks <= 0) return [];
  const tiles = onScreenTiles(terrain, cameraViewport(camera, canvasW, canvasH));
  if (tiles === null) return [];
  const band = sectorBand(tiles);
  const live = landscapeSectorsOf(snapshot);
  let tally = tallies.get(live);
  if (
    tally === undefined ||
    !sameBand(tally.band, band) ||
    tally.liveRevision !== live.revision ||
    tally.scenery !== landscape.scenery
  ) {
    const sources = landscape.scenery === undefined ? [live] : [live, landscape.scenery];
    tally = {
      band,
      liveRevision: live.revision,
      scenery: landscape.scenery,
      groups: tallyBand(band, sources, index),
    };
    tallies.set(live, tally);
  }
  const density = zoomDensity(camera.scale);
  const { random } = landscape;
  const shots: OneShot[] = [];
  for (let t = 0; t < ticks; t++) {
    for (const group of tally.groups) {
      const pool = pickPool(group.ambience, random());
      if (pool === undefined) continue;
      if (random() * LANDSCAPE_CHANCE_RANGE >= group.count * pool.chance * density) continue;
      const tile = pickObject(group, random());
      if (tile === undefined) continue;
      if (visibleTile !== undefined && !visibleTile(tile.col, tile.row)) continue;
      const spatial = computeSpatial(tile.col, tile.row, camera, canvasW, canvasH);
      if (spatial === null) continue;
      shots.push({
        files: pool.files,
        gain: spatial.gain * poolGain(index, pool.files),
        pan: spatial.pan,
        key: `landscape:${tile.col},${tile.row}`,
        lane: SFX_LANE,
      });
    }
  }
  return shots;
}
