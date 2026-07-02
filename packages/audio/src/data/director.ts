import { type Camera, ONE, cameraViewport, visibleTileRange } from '@vinland/render';
import type { SimEvent, WorldSnapshot } from '@vinland/sim';
import type { SoundIndex } from './bank.js';
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

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** The entity whose position locates a spatial event (or undefined for `at`-carrying events). */
function eventEntity(ev: SimEvent): number | undefined {
  if (ev.kind === 'buildingPlaced' || ev.kind === 'boatPlaced') return undefined;
  if (ev.kind === 'goodProduced') return ev.building as number;
  return ev.entity as number;
}

/** A stable per-emitter key so the engine can debounce a burst of identical events. */
function eventKey(ev: SimEvent): string {
  if (ev.kind === 'buildingPlaced' || ev.kind === 'boatPlaced') {
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
  if (ev.kind === 'buildingPlaced' || ev.kind === 'boatPlaced') {
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
      sampled++;
      if (typeId === undefined) continue;
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
