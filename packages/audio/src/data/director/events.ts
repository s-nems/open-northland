import { eventNode, type HalfCellNode, type SimEvent, type WorldSnapshot } from '@open-northland/sim';
import { groupFiles } from '../bank.js';
import { computeSpatial, computeSpatialAtNode, type Spatial } from '../spatial.js';
import type { DirectorInput, EventSound, OneShot, SoundBindings } from '../types.js';
import { entityOwner, entityTile, type TilePoint } from './snapshot.js';

/**
 * Sim events → one-shots: resolve each frame event through the {@link SoundBindings}, locate the
 * positioned ones (an explicit `at` half-cell node or the emitter entity's snapshot position),
 * viewport-cull and spatialise them. A jingle passes through non-spatially unless `screenGated`
 * anchors it to its event's position.
 */

/** Base gain of a life-event jingle (kept below 1 so a jingle doesn't clip over SFX). */
export const JINGLE_GAIN = 0.9;
/** Base gain of a spatial action SFX, multiplied by its spatial (distance) attenuation. */
export const SFX_GAIN = 0.8;

/**
 * The entity that names a spatial event's emitter, or `undefined` when it names none. Only asked of an
 * event with no node of its own - deciding that is the caller's job ({@link eventNode}). `goodProduced`
 * names its emitter `building`; the rest use `entity`.
 */
function eventEntity(ev: SimEvent): number | undefined {
  if (ev.kind === 'goodProduced') return ev.building as number;
  return 'entity' in ev ? (ev.entity as number) : undefined;
}

/**
 * A stable per-emitter key so the engine can debounce a burst of identical events. A positioned event keys
 * on its node, so two emitters at one spot collapse and two spots stay distinct; everything else keys on its
 * emitter entity. An `atomicSound` adds its `soundType`, since one clip can author two distinct sounds a
 * few ticks apart (a bow's draw and its arrow) and those must not debounce each other. This keys
 * `settlerDied` (a jingle carrying an optional `at`) by death node rather than by the reaped entity -
 * deliberate: the debounce should dedup "deaths here", and the reaped id is never repeated anyway, so an
 * entity key could never collapse a simultaneous pile-up.
 */
function eventKey(ev: SimEvent): string {
  const node = eventNode(ev);
  if (node !== null) return `${ev.kind}:${node.hx},${node.hy}`;
  const emitter = eventEntity(ev) ?? '?';
  if (ev.kind === 'atomicSound') return `${ev.kind}:${ev.soundType}:${emitter}`;
  return `${ev.kind}:${emitter}`;
}

/** Which sound a given event triggers, per the bindings (a melee `combatHit` keys on its weapon class with
 *  the generic-melee `byEvent` fallback). */
function resolveBinding(ev: SimEvent, bindings: SoundBindings): EventSound | undefined {
  if (ev.kind === 'combatHit' && ev.weaponMainType !== undefined) {
    const byWeapon = bindings.byCombatWeapon?.get(ev.weaponMainType);
    if (byWeapon !== undefined) return byWeapon;
  }
  return bindings.byEvent[ev.kind];
}

/**
 * Whether a {@link EventSound.localPlayerOnly} jingle should ring for `ev` by its `player` field - true
 * only when that owner equals `localPlayer`. An event carrying no `player`, a `null` owner, or no
 * configured `localPlayer` is treated as not-ours (silent) - the safe default for a notification sound.
 */
function firesForLocalPlayer(ev: SimEvent, localPlayer: number | undefined): boolean {
  if (localPlayer === undefined) return false;
  const player = 'player' in ev ? ev.player : null;
  return player === localPlayer;
}

interface PendingBase {
  readonly ev: SimEvent;
  readonly files: readonly string[];
  /** The explicit `at` half-cell node, or null when the position must come from `entity`'s
   *  snapshot Position (a fractional tile). The two spaces project through different renderer
   *  mappings - see {@link computeSpatialAtNode} vs {@link computeSpatial}. */
  readonly node: HalfCellNode | null;
  readonly entity: number | undefined;
}

/**
 * A resolved positioned event waiting for its location. An `sfx` attenuates and pans; a `cue` (an
 * animation's authored sound, always a settler's own body) additionally hides behind the viewer's fog; a
 * `stinger` (screen-gated jingle) rings at full {@link JINGLE_GAIN}, centred - the viewport cull decides
 * its audibility only.
 */
type Pending =
  | (PendingBase & { readonly kind: 'sfx' })
  | (PendingBase & { readonly kind: 'cue' })
  | (PendingBase & {
      readonly kind: 'stinger';
      /** The entity whose snapshot `Owner` must equal the local player, or null when the event's own
       *  `player` field already decided ownership. */
      readonly ownerEntity: number | null;
    });

interface EmitterFacts {
  readonly tiles: ReadonlyMap<number, TilePoint>;
  readonly owners: ReadonlyMap<number, number>;
}

/**
 * The positions and owners of exactly the `needed` entities, in one snapshot pass that allocates only
 * for them (never an all-entities table - battle-scale frames carry a handful of emitters among
 * thousands of entities) and stops as soon as every needed id is found.
 */
function emitterFacts(snapshot: WorldSnapshot, needed: ReadonlySet<number>): EmitterFacts {
  const tiles = new Map<number, TilePoint>();
  const owners = new Map<number, number>();
  let remaining = needed.size;
  for (const e of snapshot.entities) {
    if (!needed.has(e.id)) continue;
    const tile = entityTile(e.components);
    if (tile !== null) tiles.set(e.id, tile);
    const owner = entityOwner(e.components);
    if (owner !== undefined) owners.set(e.id, owner);
    remaining -= 1;
    if (remaining === 0) break;
  }
  return { tiles, owners };
}

/** The one-shots to fire for this frame's events (action SFX and screen-gated jingles viewport-culled;
 *  map-wide jingles pass through non-spatially). */
export function eventOneShots(input: DirectorInput): OneShot[] {
  const { events, snapshot, camera, canvasW, canvasH, index, bindings, localPlayer, visibleTile } = input;
  const shots: OneShot[] = [];
  if (events.length === 0) return shots; // the common frame - no events, no snapshot work at all
  // Pass 1: resolve bindings, emit jingles, and collect the entity ids the spatial events need.
  const pending: Pending[] = [];
  const neededIds = new Set<number>();
  for (const ev of events) {
    // An authored cue names its sound by the animation event's own `logicSoundType` id (data, not a
    // binding - the clip already picked the axe, the hammer, the sex-correct voice), so it resolves
    // outside the binding map. An id the bank does not carry is silent.
    if (ev.kind === 'atomicSound') {
      const files = index.groupsByLogicSoundType.get(ev.soundType);
      const id = eventEntity(ev);
      if (files !== undefined && files.length > 0 && id !== undefined) {
        neededIds.add(id);
        pending.push({ kind: 'cue', ev, files, node: null, entity: id });
      }
      continue;
    }
    const sound = resolveBinding(ev, bindings);
    if (sound === undefined) continue;
    if (sound.kind === 'jingle') {
      const files = index.jinglesByMusicType.get(sound.musicType);
      if (files === undefined || files.length === 0) continue;
      if (sound.localPlayerOnly && 'player' in ev && !firesForLocalPlayer(ev, localPlayer)) continue;
      if (sound.screenGated !== true) {
        if (sound.localPlayerOnly && !('player' in ev)) continue; // no owner path for a map-wide jingle
        shots.push({ files, gain: JINGLE_GAIN, pan: 0, key: eventKey(ev) });
        continue;
      }
      const node = eventNode(ev);
      const id = eventEntity(ev);
      let ownerEntity: number | null = null;
      if (sound.localPlayerOnly && !('player' in ev)) {
        if (id === undefined || localPlayer === undefined) continue; // owner unresolvable → silent
        ownerEntity = id;
      }
      if (node === null && id === undefined) continue; // nowhere to anchor → silent under the gate
      if (id !== undefined && (node === null || ownerEntity !== null)) neededIds.add(id);
      pending.push({ kind: 'stinger', ev, files, node, entity: id, ownerEntity });
      continue;
    }
    const files = groupFiles(index, sound.group);
    if (files === undefined) continue;
    const node = eventNode(ev);
    const id = node === null ? eventEntity(ev) : undefined;
    if (node === null && id === undefined) continue;
    if (id !== undefined) neededIds.add(id);
    pending.push({ kind: 'sfx', ev, files, node, entity: id });
  }
  // Pass 2: locate + spatialise the pending positioned events (off-screen or position-less → silent).
  const facts = neededIds.size > 0 ? emitterFacts(snapshot, neededIds) : null;
  for (const p of pending) {
    if (p.kind === 'stinger' && p.ownerEntity !== null) {
      const owner = facts?.owners.get(p.ownerEntity);
      if (owner === undefined || owner !== localPlayer) continue;
    }
    let spatial: Spatial | null = null;
    if (p.node !== null) {
      spatial = computeSpatialAtNode(p.node.hx, p.node.hy, camera, canvasW, canvasH);
    } else if (p.entity !== undefined) {
      const tile = facts?.tiles.get(p.entity) ?? null;
      if (tile === null) continue; // position-less emitter → silent
      if (p.kind === 'cue' && visibleTile !== undefined && !visibleTile(tile.col, tile.row)) continue;
      spatial = computeSpatial(tile.col, tile.row, camera, canvasW, canvasH);
    }
    if (spatial === null) continue; // off screen → silent
    if (p.kind === 'stinger') {
      shots.push({ files: p.files, gain: JINGLE_GAIN, pan: 0, key: eventKey(p.ev) });
    } else {
      shots.push({ files: p.files, gain: spatial.gain * SFX_GAIN, pan: spatial.pan, key: eventKey(p.ev) });
    }
  }
  return shots;
}
