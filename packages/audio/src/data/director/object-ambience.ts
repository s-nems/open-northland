import { type Camera, cameraViewport, type TileRange } from '@open-northland/render/data';
import { TICKS_PER_SECOND } from '@open-northland/sim';
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
 * snow, a stone settling. At the original's tick rate on the audio clock, every ambience the screen
 * shows rolls once at the original's odds and sounds at one of its objects picked at random, so a bird
 * sings from a tree on screen. Real time rather than game ticks: a fast-forward does not multiply the
 * birds.
 */

/**
 * The range a landscape ambience's chance rolls in. Original behavior, unconfirmed in play: each tick,
 * per sector and ambience, the original picks a wav by weight and fires it when `rand() % 10000` is
 * below the sector's object count times that wav's chance. The director sums the visible sectors
 * instead, which keeps the expected rate (no sector holds enough objects to saturate its roll).
 */
export const LANDSCAPE_CHANCE_RANGE = 10_000;

/** Rolls one frame makes at most; a longer frame drops the surplus rather than bursting it. */
export const MAX_LANDSCAPE_ROLLS_PER_FRAME = 5;

/** The original's screen in pre-camera pixels, the area its per-object odds were heard over.
 *  Approximation: its common 1024x768 mode. */
export const LANDSCAPE_REFERENCE_SCREEN_W = 1024;
export const LANDSCAPE_REFERENCE_SCREEN_H = 768;

/**
 * Turns audio-clock seconds into whole rolls at the original's {@link TICKS_PER_SECOND}, carrying the
 * fraction, so the rate per second holds at any frame rate and game speed.
 */
export class LandscapeRollClock {
  private carry = 0;

  /** The rolls `seconds` of running audio make, at most {@link MAX_LANDSCAPE_ROLLS_PER_FRAME}. */
  advance(seconds: number): number {
    const due = this.carry + Math.max(0, seconds) * TICKS_PER_SECOND;
    const rolls = Math.floor(due);
    this.carry = due - rolls;
    return Math.min(rolls, MAX_LANDSCAPE_ROLLS_PER_FRAME);
  }
}

const SFX_LANE: Lane = { kind: 'sfx' };

/** One ambience's objects on screen: how many, and the per-sector lists to pick one from. */
interface AmbienceTally {
  readonly ambience: LandscapeAmbience;
  count: number;
  readonly holders: ReadonlyMap<number, TilePoint>[];
}

/** The tally of one framing of the map, valid while the sector band, both sources and the sound index
 *  that joined them stand still. */
interface ScreenTally {
  readonly index: SoundIndex;
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
 * The share of the original's per-object odds a screen rolls at. A view wider than the original's
 * screen, by a larger window or a zoom-out, keeps that screen's rate instead of multiplying the
 * one-shots by the area it adds, so a forest sounds alike at any window size; a smaller view keeps the
 * per-object odds. Approximation.
 */
export function landscapeDensity(camera: Camera, canvasW: number, canvasH: number): number {
  const scale = camera.scale !== undefined && camera.scale > 0 ? camera.scale : NEAR_ZOOM_SCALE;
  const area = (canvasW / scale) * (canvasH / scale);
  if (!(area > 0)) return 0;
  return Math.min(1, (LANDSCAPE_REFERENCE_SCREEN_W * LANDSCAPE_REFERENCE_SCREEN_H) / area);
}

/**
 * This frame's landscape ambience one-shots: per due roll and per ambience on screen, one weighted pool
 * pick and one roll against the screen's object count times the pool's chance. A hit sounds at a
 * random object of the ambience, at the pool's authored volume and the object's screen position; one on
 * ground the viewer never explored stays silent, as the beds do.
 */
export function objectAmbienceShots(input: DirectorInput): OneShot[] {
  const { landscape, terrain, camera, canvasW, canvasH, index, exploredTile, snapshot } = input;
  if (landscape === undefined || terrain === undefined || index.landscapeAmbienceByRecord.size === 0)
    return [];
  const rolls = Math.min(landscape.rolls, MAX_LANDSCAPE_ROLLS_PER_FRAME);
  if (rolls <= 0) return [];
  const tiles = onScreenTiles(terrain, cameraViewport(camera, canvasW, canvasH));
  if (tiles === null) return [];
  const band = sectorBand(tiles);
  const live = landscapeSectorsOf(snapshot);
  let tally = tallies.get(live);
  if (
    tally === undefined ||
    tally.index !== index ||
    !sameBand(tally.band, band) ||
    tally.liveRevision !== live.revision ||
    tally.scenery !== landscape.scenery
  ) {
    const sources = landscape.scenery === undefined ? [live] : [live, landscape.scenery];
    tally = {
      index,
      band,
      liveRevision: live.revision,
      scenery: landscape.scenery,
      groups: tallyBand(band, sources, index),
    };
    tallies.set(live, tally);
  }
  const density = landscapeDensity(camera, canvasW, canvasH);
  const { random } = landscape;
  const shots: OneShot[] = [];
  for (let roll = 0; roll < rolls; roll++) {
    for (const group of tally.groups) {
      const pool = pickPool(group.ambience, random());
      if (pool === undefined) continue;
      if (random() * LANDSCAPE_CHANCE_RANGE >= group.count * pool.chance * density) continue;
      const tile = pickObject(group, random());
      if (tile === undefined) continue;
      if (exploredTile !== undefined && !exploredTile(tile.col, tile.row)) continue;
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
