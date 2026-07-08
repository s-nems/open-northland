import type { SimEvent, WorldSnapshot } from '@vinland/sim';
import { type TilePoint, entityTile } from './snapshot.js';
import { computeSpatial } from './spatial.js';
import type { DirectorInput, EventSound, OneShot, SoundBindings } from './types.js';

/**
 * Sim events → one-shots: resolve each frame event through the {@link SoundBindings}, locate the
 * spatial ones (an explicit `at` tile or the emitter entity's snapshot position), viewport-cull and
 * spatialise them, and pass jingles through non-spatially. Pure — the "which events sound, from
 * where, how loud" half of the director.
 */

/** Base gain of a non-spatial life-event jingle (kept below 1 so a jingle doesn't clip over SFX). */
export const JINGLE_GAIN = 0.9;
/** Base gain of a spatial action SFX, multiplied by its spatial (distance) attenuation. */
export const SFX_GAIN = 0.8;

/** The entity whose position locates a spatial event (or undefined for `at`-carrying events). */
function eventEntity(ev: SimEvent): number | undefined {
  // `at`-carrying events locate by their explicit tile, not an entity (resourceFelled/resourceDepleted
  // fire as a node comes down / is spent — position is that cell, the node already gone; a projectile
  // launch/impact fires at the shot's cell).
  if (isAtLocatedEvent(ev)) return undefined;
  if (ev.kind === 'goodProduced') return ev.building as number;
  return ev.entity as number;
}

/** Events that locate by an explicit `at` tile rather than by an emitter entity. */
function isAtLocatedEvent(ev: SimEvent): ev is Extract<SimEvent, { at: { x: number; y: number } }> {
  return (
    ev.kind === 'buildingPlaced' ||
    ev.kind === 'boatPlaced' ||
    ev.kind === 'resourceFelled' ||
    ev.kind === 'resourceDepleted' ||
    ev.kind === 'projectileLaunched' ||
    ev.kind === 'projectileHit'
  );
}

/** A stable per-emitter key so the engine can debounce a burst of identical events. */
function eventKey(ev: SimEvent): string {
  if (isAtLocatedEvent(ev)) return `${ev.kind}:${ev.at.x},${ev.at.y}`;
  return `${ev.kind}:${eventEntity(ev) ?? '?'}`;
}

/** Which sound a given event triggers, per the bindings (atomic events key on their numeric id). */
function resolveBinding(ev: SimEvent, bindings: SoundBindings): EventSound | undefined {
  if (ev.kind === 'atomicCompleted') return bindings.byAtomic.get(ev.atomicId);
  return bindings.byEvent[ev.kind];
}

/** Map of entity id → its tile position, read from the snapshot's `Position` (Fixed → tile). */
function positionsById(snapshot: WorldSnapshot): Map<number, TilePoint> {
  const out = new Map<number, TilePoint>();
  for (const e of snapshot.entities) {
    const tile = entityTile(e.components);
    if (tile !== null) out.set(e.id, tile);
  }
  return out;
}

/** The one-shots to fire for this frame's events (jingles non-spatial; action SFX viewport-culled). */
export function eventOneShots(input: DirectorInput): OneShot[] {
  const { events, snapshot, camera, canvasW, canvasH, index, bindings } = input;
  const shots: OneShot[] = [];
  if (events.length === 0) return shots; // the common frame — no events, no snapshot work at all
  // The O(entities) position scan is deferred until an entity-located bound event actually needs it,
  // so frames whose events are all jingles / `at`-located / unbound never pay it.
  let positions: Map<number, TilePoint> | null = null;
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
    let tile: TilePoint | null;
    if (isAtLocatedEvent(ev)) {
      tile = { col: ev.at.x, row: ev.at.y };
    } else {
      const id = eventEntity(ev);
      if (id === undefined) continue;
      positions ??= positionsById(snapshot);
      tile = positions.get(id) ?? null;
    }
    if (tile === null) continue;
    const spatial = computeSpatial(tile.col, tile.row, camera, canvasW, canvasH);
    if (spatial === null) continue; // off screen → silent
    shots.push({ files, gain: spatial.gain * SFX_GAIN, pan: spatial.pan, key: eventKey(ev) });
  }
  return shots;
}
