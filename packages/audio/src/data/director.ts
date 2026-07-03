import {
  type Camera,
  ONE,
  aabbIntersects,
  cameraViewport,
  tileToScreen,
  visibleTileRange,
} from '@vinland/render/data';
import type { SimEvent, WorldSnapshot } from '@vinland/sim';
import type { SoundIndex } from './bank.js';
import { clamp } from './math.js';
import { computeSpatial } from './spatial.js';
import type { AmbientLoop, AudioFrame, EventSound, OneShot, SoundBindings } from './types.js';

/**
 * The PURE audio decision: turn one frame's sim events + world snapshot + camera into the sounds that
 * should be audible — positioned one-shots for events, looping beds for on-screen terrain. No Web
 * Audio, no randomness (the engine picks a wav from each group and owns the `AudioContext`), so the
 * whole "what plays right now" policy is unit-testable headless. It reuses `render`'s projection +
 * viewport math so a sound comes from exactly where its sprite draws and only while it is on screen.
 */

/** The row-major landscape grid the ambient layer samples (the terrain the snapshot is positioned over). */
export interface AudioTerrain {
  readonly width: number;
  readonly height: number;
  readonly typeIds: readonly number[];
}

/** Everything one {@link directAudio} call needs. `terrain` is optional — absent, no ambient plays. */
export interface DirectorInput {
  readonly events: readonly SimEvent[];
  readonly snapshot: WorldSnapshot;
  readonly camera: Camera;
  readonly canvasW: number;
  readonly canvasH: number;
  readonly terrain?: AudioTerrain;
  readonly index: SoundIndex;
  readonly bindings: SoundBindings;
}

/** Base gain of a non-spatial life-event jingle (kept below 1 so a jingle doesn't clip over SFX). */
export const JINGLE_GAIN = 0.9;
/** Base gain of a spatial action SFX, multiplied by its spatial (distance) attenuation. */
export const SFX_GAIN = 0.8;
/** How many ambient beds may play at once — the loudest few by on-screen coverage. */
export const MAX_AMBIENT_BEDS = 3;
/** Loudest an ambient bed reaches. */
export const AMBIENT_MAX_GAIN = 0.5;
/** On-screen coverage fraction at which a bed hits {@link AMBIENT_MAX_GAIN} (below it, quieter). */
export const AMBIENT_FULL_COVERAGE = 0.4;
/** Cap on tiles sampled per frame for ambient — a stride keeps a zoomed-out whole-map view bounded. */
export const AMBIENT_MAX_SAMPLES = 4096;

/** The entity whose position locates a spatial event (or undefined for `at`-carrying events). */
function eventEntity(ev: SimEvent): number | undefined {
  // `at`-carrying events locate by their explicit tile, not an entity (resourceFelled fires as a tree
  // comes down — its position is the felled cell).
  if (ev.kind === 'buildingPlaced' || ev.kind === 'boatPlaced' || ev.kind === 'resourceFelled') {
    return undefined;
  }
  if (ev.kind === 'goodProduced') return ev.building as number;
  return ev.entity as number;
}

/** A stable per-emitter key so the engine can debounce a burst of identical events. */
function eventKey(ev: SimEvent): string {
  if (ev.kind === 'buildingPlaced' || ev.kind === 'boatPlaced' || ev.kind === 'resourceFelled') {
    return `${ev.kind}:${ev.at.x},${ev.at.y}`;
  }
  return `${ev.kind}:${eventEntity(ev) ?? '?'}`;
}

/** Which sound a given event triggers, per the bindings (atomic events key on their numeric id). */
function resolveBinding(ev: SimEvent, bindings: SoundBindings): EventSound | undefined {
  if (ev.kind === 'atomicCompleted') return bindings.byAtomic.get(ev.atomicId);
  return bindings.byEvent[ev.kind];
}

/** Map of entity id → its tile position, read from the snapshot's `Position` (Fixed → tile). */
function positionsById(snapshot: WorldSnapshot): Map<number, { col: number; row: number }> {
  const out = new Map<number, { col: number; row: number }>();
  for (const e of snapshot.entities) {
    const p = e.components.Position as { x?: unknown; y?: unknown } | undefined;
    if (p === undefined || typeof p.x !== 'number' || typeof p.y !== 'number') continue;
    out.set(e.id, { col: p.x / ONE, row: p.y / ONE });
  }
  return out;
}

/** The tile an event's sound emits from: its explicit `at`, or its entity's snapshot position. */
function eventTile(
  ev: SimEvent,
  positions: ReadonlyMap<number, { col: number; row: number }>,
): { col: number; row: number } | null {
  if (ev.kind === 'buildingPlaced' || ev.kind === 'boatPlaced' || ev.kind === 'resourceFelled') {
    return { col: ev.at.x, row: ev.at.y };
  }
  const id = eventEntity(ev);
  if (id === undefined) return null;
  return positions.get(id) ?? null;
}

/** The one-shots to fire for this frame's events (jingles non-spatial; action SFX viewport-culled). */
function oneShotsFor(input: DirectorInput): OneShot[] {
  const { events, snapshot, camera, canvasW, canvasH, index, bindings } = input;
  const positions = positionsById(snapshot);
  const shots: OneShot[] = [];
  for (const ev of events) {
    const sound = resolveBinding(ev, bindings);
    if (sound === undefined) continue;
    if (sound.kind === 'jingle') {
      const files = index.jinglesByMusicType.get(sound.musicType);
      if (files && files.length > 0) {
        shots.push({ files, gain: JINGLE_GAIN, pan: 0, key: eventKey(ev) });
      }
      continue;
    }
    const files = index.groupsByName.get(sound.group.toLowerCase());
    if (files === undefined || files.length === 0) continue;
    const tile = eventTile(ev, positions);
    if (tile === null) continue;
    const spatial = computeSpatial(tile.col, tile.row, camera, canvasW, canvasH);
    if (spatial === null) continue; // off screen → silent
    shots.push({ files, gain: spatial.gain * SFX_GAIN, pan: spatial.pan, key: eventKey(ev) });
  }
  return shots;
}

/** The ambient beds active this frame, by sampling the on-screen terrain tiles (coverage-weighted gain). */
function ambientFor(input: DirectorInput): AmbientLoop[] {
  const { terrain, camera, canvasW, canvasH, index } = input;
  if (terrain === undefined || terrain.width <= 0 || terrain.height <= 0) return [];
  const vp = cameraViewport(camera, canvasW, canvasH);
  // The map's projected world-space bounds: its four corner tiles. When the camera frames only empty
  // space beyond the grid, the viewport doesn't overlap this box, so no terrain is on screen and no
  // ambient should play — `visibleTileRange`'s clamp would otherwise collapse to a phantom edge tile.
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
  // A stride keeps a zoomed-all-the-way-out view (band == whole map) bounded to ~AMBIENT_MAX_SAMPLES.
  const stride = Math.max(1, Math.ceil(Math.sqrt((cols * rows) / AMBIENT_MAX_SAMPLES)));
  const counts = new Map<string, number>();
  let sampled = 0;
  for (let row = band.minRow; row <= band.maxRow; row += stride) {
    for (let col = band.minCol; col <= band.maxCol; col += stride) {
      const typeId = terrain.typeIds[row * terrain.width + col];
      if (typeId === undefined) continue; // out-of-range (malformed grid): don't dilute the coverage denominator
      sampled++;
      const beds = index.ambientByTerrainType.get(typeId);
      if (beds === undefined) continue;
      for (const bed of beds) counts.set(bed, (counts.get(bed) ?? 0) + 1);
    }
  }
  if (sampled === 0) return [];
  return [...counts.entries()]
    .map(([name, hits]) => ({ name, coverage: hits / sampled }))
    .sort((a, b) => b.coverage - a.coverage)
    .slice(0, MAX_AMBIENT_BEDS)
    .flatMap(({ name, coverage }): AmbientLoop[] => {
      const file = index.ambientLoopByName.get(name);
      if (file === undefined) return [];
      const gain = AMBIENT_MAX_GAIN * clamp(Math.sqrt(coverage) / Math.sqrt(AMBIENT_FULL_COVERAGE), 0, 1);
      return [{ name, file, gain }];
    });
}

/** Decide the full audio for one frame: the one-shots to fire and the ambient loops that should be live. */
export function directAudio(input: DirectorInput): AudioFrame {
  return { oneShots: oneShotsFor(input), ambient: ambientFor(input) };
}

/** One on-screen settler as a chatter candidate: its id, the spatialisation of a sound from it, and the
 *  facts that classify its voice (so a male crowd sounds male). */
export interface OnScreenSettler {
  readonly entity: number;
  /** Stereo pan for a voice from this settler, -1..1. */
  readonly pan: number;
  /** Distance-attenuated gain for a voice from this settler, 0..1. */
  readonly gain: number;
  /** The settler's `jobType` (null when unemployed) — the sex split key (the mod's `woman` job is female). */
  readonly jobType: number | null;
  /** Whether the settler still carries an `Age` (a baby/child) — a young settler gets a child voice. */
  readonly young: boolean;
}

/**
 * The settlers currently on screen (a `Settler` component + an in-view `Position`), each with its
 * spatialisation — the PURE candidate list the voice-chatter layer picks from. Kept here (not in the
 * driver) so the "who could speak" half stays headless-testable; the STOCHASTIC "who speaks now" half
 * lives in the impure {@link import('../web/sound-driver.js').SoundDriver} (it needs randomness + time).
 */
export function onScreenSettlers(
  snapshot: WorldSnapshot,
  camera: Camera,
  canvasW: number,
  canvasH: number,
): OnScreenSettler[] {
  const out: OnScreenSettler[] = [];
  for (const e of snapshot.entities) {
    if (!('Settler' in e.components)) continue;
    const p = e.components.Position as { x?: unknown; y?: unknown } | undefined;
    if (p === undefined || typeof p.x !== 'number' || typeof p.y !== 'number') continue;
    const spatial = computeSpatial(p.x / ONE, p.y / ONE, camera, canvasW, canvasH);
    if (spatial === null) continue;
    // Read the sex/age classifiers straight off the plain snapshot (Settler.jobType + Age-presence) — the
    // same facts render's roster join uses, so a settler sounds like the body it draws.
    const settler = e.components.Settler as { jobType?: unknown };
    const jobType = typeof settler.jobType === 'number' ? settler.jobType : null;
    out.push({ entity: e.id, pan: spatial.pan, gain: spatial.gain, jobType, young: 'Age' in e.components });
  }
  return out;
}
