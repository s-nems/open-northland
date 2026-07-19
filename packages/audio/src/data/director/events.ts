import { eventNode, type HalfCellNode, type SimEvent, type WorldSnapshot } from '@open-northland/sim';
import { groupFiles } from '../bank.js';
import { computeSpatial, computeSpatialAtNode, type Spatial } from '../spatial.js';
import type { DirectorInput, EventSound, OneShot, SoundBindings } from '../types.js';
import { entityTile, type TilePoint } from './snapshot.js';

/**
 * Sim events → one-shots: resolve each frame event through the {@link SoundBindings}, locate the spatial
 * ones (an explicit `at` half-cell node or the emitter entity's snapshot position), viewport-cull and
 * spatialise them, and pass jingles through non-spatially.
 */

/** Base gain of a non-spatial life-event jingle (kept below 1 so a jingle doesn't clip over SFX). */
export const JINGLE_GAIN = 0.9;
/** Base gain of a spatial action SFX, multiplied by its spatial (distance) attenuation. */
export const SFX_GAIN = 0.8;
/** Base gain of a `chatVoice` settler line (below SFX so conversation sits under the action, not over it). */
export const CHAT_VOICE_GAIN = 0.7;

/**
 * The entity that names a spatial event's emitter, or `undefined` when it names none. Only asked of an
 * event with no node of its own — deciding that is the caller's job ({@link eventNode}). `goodProduced`
 * names its emitter `building`; the rest use `entity`.
 */
function eventEntity(ev: SimEvent): number | undefined {
  if (ev.kind === 'goodProduced') return ev.building as number;
  return 'entity' in ev ? (ev.entity as number) : undefined;
}

/**
 * A stable per-emitter key so the engine can debounce a burst of identical events. A positioned event keys
 * on its node, so two emitters at one spot collapse and two spots stay distinct; everything else keys on its
 * emitter entity. This keys `settlerDied` (a jingle carrying an optional `at`) by death node rather than by
 * the reaped entity — deliberate: the debounce should dedup "deaths here", and the reaped id is never
 * repeated anyway, so an entity key could never collapse a simultaneous pile-up.
 */
function eventKey(ev: SimEvent): string {
  const node = eventNode(ev);
  if (node !== null) return `${ev.kind}:${node.hx},${node.hy}`;
  return `${ev.kind}:${eventEntity(ev) ?? '?'}`;
}

/** Which sound a given event triggers, per the bindings (atomic events key on their numeric id, a melee
 *  `combatHit` on its weapon class with the generic-melee `byEvent` fallback). */
function resolveBinding(ev: SimEvent, bindings: SoundBindings): EventSound | undefined {
  if (ev.kind === 'atomicCompleted') return bindings.byAtomic.get(ev.atomicId);
  if (ev.kind === 'atomicSound') return bindings.byAtomicSound.get(ev.atomicId);
  if (ev.kind === 'combatHit' && ev.weaponMainType !== undefined) {
    const byWeapon = bindings.byCombatWeapon?.get(ev.weaponMainType);
    if (byWeapon !== undefined) return byWeapon;
  }
  return bindings.byEvent[ev.kind];
}

/**
 * Whether a {@link EventSound.localPlayerOnly} jingle should ring for `ev` — true only when the event's
 * owner `player` equals `localPlayer`. An event carrying no `player`, or no configured `localPlayer`, is
 * treated as not-ours (silent) — the safe default for a notification sound.
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
  readonly node: HalfCellNode | null;
  readonly entity: number | undefined;
  /** Pre-attenuation gain: {@link SFX_GAIN} for action SFX, {@link CHAT_VOICE_GAIN} for a voice line. */
  readonly baseGain: number;
  /** Whether the viewer's fog gates this sound (a voice from fogged ground stays silent — action SFX
   *  keep their existing fog-agnostic behaviour). */
  readonly fogGated: boolean;
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
  const { events, snapshot, camera, canvasW, canvasH, index, bindings, localPlayer, visibleTile } = input;
  const shots: OneShot[] = [];
  if (events.length === 0) return shots; // the common frame — no events, no snapshot work at all
  // Pass 1: resolve bindings, emit jingles, and collect the entity ids the spatial events need.
  const pending: PendingSpatial[] = [];
  const neededIds = new Set<number>();
  for (const ev of events) {
    // A chat voice names its sound by the animation event's own `logicSoundType` id (data, not a
    // binding — the clip already picked the sex-correct group), so it resolves before the binding map.
    if (ev.kind === 'chatVoice') {
      const files = index.groupsByLogicSoundType.get(ev.soundType);
      const id = eventEntity(ev);
      if (files !== undefined && files.length > 0 && id !== undefined) {
        neededIds.add(id);
        pending.push({ ev, files, node: null, entity: id, baseGain: CHAT_VOICE_GAIN, fogGated: true });
      }
      continue;
    }
    const sound = resolveBinding(ev, bindings);
    if (sound === undefined) continue;
    if (sound.kind === 'jingle') {
      if (sound.localPlayerOnly && !firesForLocalPlayer(ev, localPlayer)) continue;
      const files = index.jinglesByMusicType.get(sound.musicType);
      if (files && files.length > 0) {
        shots.push({ files, gain: JINGLE_GAIN, pan: 0, key: eventKey(ev) });
      }
      continue;
    }
    const files = groupFiles(index, sound.group);
    if (files === undefined) continue;
    const node = eventNode(ev);
    if (node !== null) {
      pending.push({ ev, files, node, entity: undefined, baseGain: SFX_GAIN, fogGated: false });
    } else {
      const id = eventEntity(ev);
      if (id === undefined) continue;
      neededIds.add(id);
      pending.push({ ev, files, node: null, entity: id, baseGain: SFX_GAIN, fogGated: false });
    }
  }
  // Pass 2: locate + spatialise the pending spatial events (off-screen or position-less → silent).
  const positions = neededIds.size > 0 ? positionsFor(snapshot, neededIds) : null;
  for (const p of pending) {
    let spatial: Spatial | null = null;
    if (p.node !== null) {
      spatial = computeSpatialAtNode(p.node.hx, p.node.hy, camera, canvasW, canvasH);
    } else if (p.entity !== undefined) {
      const tile = positions?.get(p.entity) ?? null;
      if (tile === null) continue; // position-less emitter → silent
      if (p.fogGated && visibleTile !== undefined && !visibleTile(tile.col, tile.row)) continue;
      spatial = computeSpatial(tile.col, tile.row, camera, canvasW, canvasH);
    }
    if (spatial === null) continue; // off screen → silent
    shots.push({ files: p.files, gain: spatial.gain * p.baseGain, pan: spatial.pan, key: eventKey(p.ev) });
  }
  return shots;
}
