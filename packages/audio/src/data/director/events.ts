import type { SimEvent, WorldSnapshot } from '@vinland/sim';
import { computeSpatial, computeSpatialAtNode } from '../spatial.js';
import type { DirectorInput, EventSound, OneShot, SoundBindings } from '../types.js';
import { type TilePoint, entityTile } from './snapshot.js';

/**
 * Sim events → one-shots: resolve each frame event through the {@link SoundBindings}, locate the
 * spatial ones (an explicit `at` HALF-CELL NODE or the emitter entity's snapshot position),
 * viewport-cull and spatialise them, and pass jingles through non-spatially. Pure — the "which
 * events sound, from where, how loud" half of the director.
 */

/** Base gain of a non-spatial life-event jingle (kept below 1 so a jingle doesn't clip over SFX). */
export const JINGLE_GAIN = 0.9;
/** Base gain of a spatial action SFX, multiplied by its spatial (distance) attenuation. */
export const SFX_GAIN = 0.8;

/** The entity whose position locates a spatial event (or undefined for `at`-carrying events). */
function eventEntity(ev: SimEvent): number | undefined {
  // `at`-carrying events locate by their explicit half-cell node, not an entity (resourceFelled/
  // resourceDepleted fire as a node comes down / is spent — position is that node, the entity
  // already gone; a projectile launch/impact fires at the shot's node).
  if (isAtLocatedEvent(ev)) return undefined;
  if (ev.kind === 'goodProduced') return ev.building as number;
  return ev.entity as number;
}

/** Events that locate by an explicit `at` half-cell node rather than by an emitter entity. */
function isAtLocatedEvent(ev: SimEvent): ev is Extract<SimEvent, { at: { x: number; y: number } }> {
  return (
    ev.kind === 'buildingPlaced' ||
    ev.kind === 'boatPlaced' ||
    ev.kind === 'resourceFelled' ||
    ev.kind === 'resourceDepleted' ||
    ev.kind === 'projectileLaunched' ||
    ev.kind === 'projectileHit' ||
    ev.kind === 'combatHit' ||
    ev.kind === 'combatSwing'
  );
}

/** A stable per-emitter key so the engine can debounce a burst of identical events. */
function eventKey(ev: SimEvent): string {
  if (isAtLocatedEvent(ev)) return `${ev.kind}:${ev.at.x},${ev.at.y}`;
  return `${ev.kind}:${eventEntity(ev) ?? '?'}`;
}

/** Which sound a given event triggers, per the bindings (atomic events key on their numeric id, a melee
 *  `combatHit` on its weapon class with the generic-melee `byEvent` fallback). */
function resolveBinding(ev: SimEvent, bindings: SoundBindings): EventSound | undefined {
  if (ev.kind === 'atomicCompleted') return bindings.byAtomic.get(ev.atomicId);
  if (ev.kind === 'combatHit' && ev.weaponMainType !== undefined) {
    const byWeapon = bindings.byCombatWeapon?.get(ev.weaponMainType);
    if (byWeapon !== undefined) return byWeapon;
  }
  return bindings.byEvent[ev.kind];
}

/**
 * Whether a {@link EventSound.localPlayerOnly} jingle should ring for `ev` — true only when the event
 * carries an owner `player` that equals `localPlayer` (the death stinger fires for the player's OWN
 * unit, never an enemy's or a wild animal's `null`-owned death). A jingle without this flag never
 * reaches here; an event carrying no `player` field, or no configured `localPlayer`, is treated as
 * not-ours (silent) — the safe default for a notification sound.
 */
function firesForLocalPlayer(ev: SimEvent, localPlayer: number | undefined): boolean {
  if (localPlayer === undefined) return false;
  const player = 'player' in ev ? ev.player : null;
  return player === localPlayer;
}

/** A resolved spatial event waiting for its position: the bound files plus where the sound comes from. */
interface PendingSpatial {
  readonly ev: SimEvent;
  readonly files: readonly string[];
  /** The explicit `at` half-cell node, or null when the position must come from `entity`'s
   *  snapshot Position (a fractional tile). The two spaces project through different renderer
   *  mappings — see {@link computeSpatialAtNode} vs {@link computeSpatial}. */
  readonly node: { readonly hx: number; readonly hy: number } | null;
  readonly entity: number | undefined;
}

/**
 * The positions of exactly the `needed` entities, in one snapshot pass that allocates only for them
 * (never an all-entities table — battle-scale frames carry a handful of emitters among thousands of
 * entities) and stops as soon as every needed id is found.
 */
function positionsFor(snapshot: WorldSnapshot, needed: ReadonlySet<number>): Map<number, TilePoint> {
  const out = new Map<number, TilePoint>();
  for (const e of snapshot.entities) {
    if (!needed.has(e.id)) continue;
    const tile = entityTile(e.components);
    if (tile !== null) out.set(e.id, tile);
    if (out.size === needed.size) break;
  }
  return out;
}

/** The one-shots to fire for this frame's events (jingles non-spatial; action SFX viewport-culled). */
export function eventOneShots(input: DirectorInput): OneShot[] {
  const { events, snapshot, camera, canvasW, canvasH, index, bindings, localPlayer } = input;
  const shots: OneShot[] = [];
  if (events.length === 0) return shots; // the common frame — no events, no snapshot work at all
  // Pass 1: resolve bindings, emit jingles, and collect which entity ids the spatial events actually
  // need — so the snapshot scan below touches only those (O(events) ids, not an O(entities) table).
  const pending: PendingSpatial[] = [];
  const neededIds = new Set<number>();
  for (const ev of events) {
    const sound = resolveBinding(ev, bindings);
    if (sound === undefined) continue;
    if (sound.kind === 'jingle') {
      // A local-player-only jingle (the death stinger) is silent for a non-local / unowned event.
      if (sound.localPlayerOnly && !firesForLocalPlayer(ev, localPlayer)) continue;
      const files = index.jinglesByMusicType.get(sound.musicType);
      if (files && files.length > 0) {
        shots.push({ files, gain: JINGLE_GAIN, pan: 0, key: eventKey(ev) });
      }
      continue;
    }
    const files = index.groupsByName.get(sound.group.toLowerCase());
    if (files === undefined || files.length === 0) continue;
    if (isAtLocatedEvent(ev)) {
      pending.push({ ev, files, node: { hx: ev.at.x, hy: ev.at.y }, entity: undefined });
    } else {
      const id = eventEntity(ev);
      if (id === undefined) continue;
      neededIds.add(id);
      pending.push({ ev, files, node: null, entity: id });
    }
  }
  // Pass 2: locate + spatialise the pending spatial events (off-screen or position-less → silent).
  const positions = neededIds.size > 0 ? positionsFor(snapshot, neededIds) : null;
  for (const p of pending) {
    let spatial: ReturnType<typeof computeSpatial> = null;
    if (p.node !== null) {
      spatial = computeSpatialAtNode(p.node.hx, p.node.hy, camera, canvasW, canvasH);
    } else if (p.entity !== undefined) {
      const tile = positions?.get(p.entity) ?? null;
      if (tile === null) continue; // position-less emitter → silent
      spatial = computeSpatial(tile.col, tile.row, camera, canvasW, canvasH);
    }
    if (spatial === null) continue; // off screen → silent
    shots.push({ files: p.files, gain: spatial.gain * SFX_GAIN, pan: spatial.pan, key: eventKey(p.ev) });
  }
  return shots;
}
