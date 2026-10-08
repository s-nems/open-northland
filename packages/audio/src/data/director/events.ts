import {
  cellOfNode,
  entityById,
  eventNode,
  type HalfCellNode,
  ONE,
  type SimEvent,
  type WorldSnapshot,
} from '@open-northland/sim';
import { groupFiles, poolGain, type SoundIndex } from '../bank.js';
import { JINGLE_COMBAT_INTERVAL_S, jingleDuck } from '../bindings.js';
import type { ShotLayer } from '../perspective.js';
import { entityOwner, entityTile, type TilePoint } from '../snapshot.js';
import { computeSpatial, computeSpatialAtNode, type Spatial } from '../spatial.js';
import type { AudioTerrain, DirectorInput, EventSound, Lane, OneShot, SoundBindings } from '../types.js';
import { uiCueShot } from '../ui-cues.js';
import { humanVoicesOf } from '../voices.js';

/**
 * Sim events → one-shots: resolve each frame event through the {@link SoundBindings}, locate the
 * positioned ones (an explicit `at` half-cell node or the emitter entity's snapshot position),
 * viewport-cull and spatialise them. A jingle passes through non-spatially unless `screenGated`
 * anchors it to its event's position. An event that already names its sound-bank group by
 * `logicSoundType` id (an animation's authored cue, a script's `PlaySound`, a weapon's listed impact or
 * thud) resolves by that id instead of a binding.
 */

/**
 * Least construction progress (fixed-point fraction of ONE) at which a destroyed building crashes
 * audibly. Original behavior: a finished house, a house
 * in an upgrade, or a site at least half built collapses with the crash sound; a less-built site is
 * torn down silently.
 */
export const HOUSE_CRASH_MIN_BUILT = ONE / 2;

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
 * emitter entity. An `atomicSound` or a script's `missionSound` adds its `soundType`, since one clip can
 * author two distinct sounds a few ticks apart (a bow's draw and its arrow) and those must not debounce
 * each other. This keys `settlerDied` (a jingle carrying an optional `at`) by death node rather than by the
 * reaped entity - deliberate: the debounce should dedup "deaths here", and the reaped id is never repeated
 * anyway, so an entity key could never collapse a simultaneous pile-up.
 */
function eventKey(ev: SimEvent): string {
  const node = eventNode(ev);
  if (ev.kind === 'missionSound') return `${ev.kind}:${ev.soundType}:${ev.at.hx},${ev.at.hy}`;
  if (node !== null) return `${ev.kind}:${node.hx},${node.hy}`;
  const emitter = eventEntity(ev) ?? '?';
  if (ev.kind === 'atomicSound') return `${ev.kind}:${ev.soundType}:${emitter}`;
  return `${ev.kind}:${emitter}`;
}

/** Chest opening emits both its kind-specific lid sound and the common jingle; distinct keys keep the
 *  playback driver's debounce from collapsing either half. */
function soundKey(ev: SimEvent, sound: EventSound): string {
  const key = eventKey(ev);
  if (ev.kind !== 'chestOpened') return key;
  return sound.kind === 'spatial' ? `${key}:${ev.chestKind}` : `${key}:jingle`;
}

/** A jingle's one-shot: at its authored volume times `share`, centred, carrying its type's music duck
 *  scaled by the share, in the jingle lane under that type. While the player fights (`tense`), a type
 *  with a combat interval rings under one key that cools for that interval, and ducks nothing. */
function jingleShot(
  index: SoundIndex,
  files: readonly string[],
  key: string,
  musicType: number,
  tense: boolean,
  share = 1,
): OneShot {
  const lane: Lane = { kind: 'jingle', musicType };
  const gain = poolGain(index, files) * share;
  const combatIntervalS = tense ? JINGLE_COMBAT_INTERVAL_S.get(musicType) : undefined;
  if (combatIntervalS !== undefined) {
    return { files, gain, pan: 0, key: `jingle:${musicType}:combat`, lane, cooldownS: combatIntervalS };
  }
  const duck = jingleDuck(musicType, share);
  return duck === undefined
    ? { files, gain, pan: 0, key, lane }
    : { files, gain, pan: 0, key, lane, ...duck };
}

const SFX_LANE: Lane = { kind: 'sfx' };
const SCREAM_LANE: Lane = { kind: 'voice', scream: true };

/** Which sounds a given event triggers, per the bindings. A chest adds its kind-specific lid sound to the
 *  common jingle; a building torn down before {@link HOUSE_CRASH_MIN_BUILT} makes no sound. */
function resolveBindings(ev: SimEvent, bindings: SoundBindings): EventSound[] {
  if (ev.kind === 'buildingDestroyed' && ev.upgrading !== true && ev.built < HOUSE_CRASH_MIN_BUILT) return [];
  const common = bindings.byEvent[ev.kind];
  if (ev.kind !== 'chestOpened') return common === undefined ? [] : [common];
  const lid = bindings.byChestKind?.[ev.chestKind];
  if (lid === undefined) return common === undefined ? [] : [common];
  return common === undefined ? [lid] : [lid, common];
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
  readonly files: readonly string[];
  readonly key: string;
  /** Skip while the picked wav still sounds ({@link OneShot.exclusive}). */
  readonly exclusive?: 'wav';
  /** The zoom layer ({@link OneShot.layer}); absent is `detail`. */
  readonly layer?: ShotLayer;
  /** Where an event at an explicit `at` node sounds, placed once in pass 1; null only for a stinger
   *  that still rings from off screen. Unused when `entity` places the sound. */
  readonly spatial: Spatial | null;
  /** The entity whose snapshot Position (a fractional tile) places the sound, for an event without a
   *  node of its own. The two spaces project through different renderer mappings - see
   *  {@link computeSpatialAtNode} vs {@link computeSpatial}. */
  readonly entity: number | undefined;
}

/**
 * A resolved positioned event waiting for its location. An `sfx` attenuates and pans; a `cue` (an
 * animation's authored sound, always a settler's own body) additionally hides behind the viewer's fog; a
 * `scream` is the struck body's own voice, resolved from the victim's snapshot identity once located; a
 * `stinger` (screen-gated jingle) rings at its authored volume, centred - the viewport cull decides its
 * audibility only.
 */
type Pending =
  | (PendingBase & { readonly kind: 'sfx' })
  | (PendingBase & { readonly kind: 'cue' })
  | (Omit<PendingBase, 'files'> & { readonly kind: 'scream'; readonly victim: number })
  | (PendingBase & {
      readonly kind: 'stinger';
      /** The entity whose snapshot `Owner` must equal the local player, or null when the event's own
       *  `player` field already decided ownership. */
      readonly ownerEntity: number | null;
      readonly musicType: number;
      /** The gain share it rings at from off screen; absent, off screen is silent. */
      readonly offScreenGain?: number;
    });

interface EmitterFacts {
  readonly tiles: ReadonlyMap<number, TilePoint>;
  readonly owners: ReadonlyMap<number, number>;
  /** The scream group of each needed entity that is a person with a voice for its class. */
  readonly screams: ReadonlyMap<number, string>;
}

/** The positions, owners and scream groups of exactly the `needed` entities, by per-id binary search: the
 *  emitter set follows the busy population now that every working settler cues its own animation. */
function emitterFacts(snapshot: WorldSnapshot, index: SoundIndex, needed: ReadonlySet<number>): EmitterFacts {
  const tiles = new Map<number, TilePoint>();
  const owners = new Map<number, number>();
  const screams = new Map<number, string>();
  for (const id of needed) {
    const e = entityById(snapshot, id);
    if (e === undefined) continue;
    const tile = entityTile(e.components);
    if (tile !== null) tiles.set(id, tile);
    const owner = entityOwner(e.components);
    if (owner !== undefined) owners.set(id, owner);
    const scream = humanVoicesOf(index, e)?.scream;
    if (scream !== undefined) screams.set(id, scream);
  }
  return { tiles, owners, screams };
}

/**
 * The `logicSoundType` a landing shot thuds with: the weapon's `soundtype_NoHit` entry for the logic type
 * of the ground under the landing node's cell, read off the landscape grid the ambient layer samples.
 * Undefined without a grid, off it, or where the table lists none (a scene's synthetic ground has no logic
 * type). Approximation: the grid's logic type is the cell's representative pattern family (water, land,
 * mountain), where the original reads the landing point's own ground byte, so a beach or snow column of
 * the table is never reached here.
 */
function missSoundType(
  missSounds: Readonly<Record<string, number>>,
  at: HalfCellNode,
  terrain: AudioTerrain | undefined,
  index: SoundIndex,
): number | undefined {
  if (terrain === undefined) return undefined;
  const { cx, cy } = cellOfNode(at.hx, at.hy);
  if (cy < 0 || cy >= terrain.height || cx < 0 || cx >= terrain.width) return undefined;
  const typeId = terrain.typeIds[cy * terrain.width + cx];
  const logicType = typeId === undefined ? undefined : index.groundLogicTypeByTerrainType.get(typeId);
  return logicType === undefined ? undefined : missSounds[String(logicType)];
}

/**
 * A weapon's listed impact or thud, named by a `logicSoundType` id like an animation's cue. A blow on a
 * body is exclusive, a blow on a building or a shot into the ground layers freely: the original
 * skips only a body hit while the previous one is still sounding. Approximation: the original
 * sounds a body blow only when it did damage, this every landed one.
 */
function weaponSoundPending(
  ev: SimEvent,
  spatial: Spatial,
  index: SoundIndex,
  terrain: AudioTerrain | undefined,
): Pending | null {
  let soundType: number | undefined;
  if (ev.kind === 'combatHit' || ev.kind === 'projectileHit') soundType = ev.soundType;
  else if (ev.kind === 'projectileMissed') soundType = missSoundType(ev.missSounds, ev.at, terrain, index);
  else return null;
  if (soundType === undefined) return null;
  const files = index.groupsByLogicSoundType.get(soundType);
  if (files === undefined || files.length === 0) return null;
  const onBody = ev.kind !== 'projectileMissed' && ev.structure !== true;
  return {
    kind: 'sfx',
    files,
    key: `${ev.kind}:${soundType}:${ev.at.hx},${ev.at.hy}`,
    spatial,
    entity: undefined,
    layer: 'impact',
    ...(onBody ? { exclusive: 'wav' as const } : {}),
  };
}

/** The struck body's scream, waiting for the victim's voice; a blow on a building screams nothing. The
 *  same damaging-blow approximation as the impact applies. */
function screamPending(ev: SimEvent, spatial: Spatial): Extract<Pending, { kind: 'scream' }> | null {
  if ((ev.kind !== 'combatHit' && ev.kind !== 'projectileHit') || ev.structure === true) return null;
  return {
    kind: 'scream',
    key: `scream:${ev.at.hx},${ev.at.hy}`,
    spatial,
    entity: undefined,
    victim: ev.target as number,
    exclusive: 'wav',
    layer: 'impact',
  };
}

/** The one-shots to fire for this frame's events (action SFX and screen-gated jingles viewport-culled;
 *  map-wide jingles pass through non-spatially). An event at an explicit node is placed first, so one
 *  off screen costs no entity read, fog check, pending or key, however big the battle it belongs to. */
export function eventOneShots(input: DirectorInput): OneShot[] {
  const { events, snapshot, camera, canvasW, canvasH, index, bindings, localPlayer, visibleTile, terrain } =
    input;
  const tense = input.tense === true;
  const shots: OneShot[] = [];
  if (events.length === 0) return shots; // the common frame - no events, no snapshot work at all
  // Pass 1: place the node events, resolve bindings, emit jingles, and collect the entity ids the
  // on-screen and entity-placed events need.
  const pending: Pending[] = [];
  const neededIds = new Set<number>();
  for (const ev of events) {
    const node = eventNode(ev);
    const spatial = node === null ? null : computeSpatialAtNode(node.hx, node.hy, camera, canvasW, canvasH);
    const offScreen = node !== null && spatial === null;
    // A blow names its impact by the weapon's listed id, and the struck body screams in its own voice.
    if (spatial !== null) {
      const weaponSound = weaponSoundPending(ev, spatial, index, terrain);
      if (weaponSound !== null) pending.push(weaponSound);
      const scream = screamPending(ev, spatial);
      if (scream !== null) {
        neededIds.add(scream.victim);
        pending.push(scream);
      }
    }
    // An authored cue names its sound by the animation event's own `logicSoundType` id (data, not a
    // binding - the clip already picked the axe, the hammer, the sex-correct voice), so it resolves
    // outside the binding map. An id the bank does not carry is silent.
    if (ev.kind === 'atomicSound') {
      const files = index.groupsByLogicSoundType.get(ev.soundType);
      const id = eventEntity(ev);
      if (files !== undefined && files.length > 0 && id !== undefined) {
        neededIds.add(id);
        pending.push({ kind: 'cue', files, key: eventKey(ev), spatial: null, entity: id });
      }
      continue;
    }
    // A map script's `PlaySound` names its group the same way, at a point of its own.
    if (ev.kind === 'missionSound') {
      const files = index.groupsByLogicSoundType.get(ev.soundType);
      if (files !== undefined && files.length > 0 && spatial !== null) {
        // A script's sound is a story beat, so it carries from far out like a fight does.
        pending.push({ kind: 'sfx', files, key: eventKey(ev), spatial, entity: undefined, layer: 'impact' });
      }
      continue;
    }
    for (const sound of resolveBindings(ev, bindings)) {
      if (sound.kind === 'cue') {
        shots.push(uiCueShot(sound.cue));
        continue;
      }
      if (sound.kind === 'jingle') {
        const files = index.jinglesByMusicType.get(sound.musicType);
        if (files === undefined || files.length === 0) continue;
        if (sound.localPlayerOnly && 'player' in ev && !firesForLocalPlayer(ev, localPlayer)) continue;
        if (sound.screenGated !== true) {
          if (sound.localPlayerOnly && !('player' in ev)) continue; // no owner path for a map-wide jingle
          shots.push(jingleShot(index, files, soundKey(ev, sound), sound.musicType, tense));
          continue;
        }
        if (offScreen && sound.offScreenGain === undefined) continue; // off screen → silent under the gate
        const id = eventEntity(ev);
        let ownerEntity: number | null = null;
        if (sound.localPlayerOnly && !('player' in ev)) {
          if (id === undefined || localPlayer === undefined) continue; // owner unresolvable → silent
          ownerEntity = id;
        }
        if (node === null && id === undefined) continue; // nowhere to anchor → silent under the gate
        if (id !== undefined && (node === null || ownerEntity !== null)) neededIds.add(id);
        pending.push({
          kind: 'stinger',
          files,
          key: soundKey(ev, sound),
          spatial,
          entity: node === null ? id : undefined,
          ownerEntity,
          musicType: sound.musicType,
          ...(sound.offScreenGain !== undefined ? { offScreenGain: sound.offScreenGain } : {}),
        });
        continue;
      }
      if (offScreen) continue;
      const files = groupFiles(index, sound.group);
      if (files === undefined) continue;
      const id = node === null ? eventEntity(ev) : undefined;
      if (node === null && id === undefined) continue;
      if (id !== undefined) neededIds.add(id);
      pending.push({
        kind: 'sfx',
        files,
        key: soundKey(ev, sound),
        spatial,
        entity: id,
        ...(sound.layer !== undefined ? { layer: sound.layer } : {}),
      });
    }
  }
  // Pass 2: place the entity events and spatialise every pending one (off-screen or position-less →
  // silent); the fog hides only a cue already on screen.
  const facts = neededIds.size > 0 ? emitterFacts(snapshot, index, neededIds) : null;
  for (const p of pending) {
    if (p.kind === 'stinger' && p.ownerEntity !== null) {
      const owner = facts?.owners.get(p.ownerEntity);
      if (owner === undefined || owner !== localPlayer) continue;
    }
    let files: readonly string[];
    if (p.kind === 'scream') {
      const group = facts?.screams.get(p.victim);
      const voice = group === undefined ? undefined : groupFiles(index, group);
      if (voice === undefined) continue; // a voiceless body (an animal, a silent tribe) → no scream
      files = voice;
    } else {
      files = p.files;
    }
    let spatial = p.spatial;
    if (p.entity !== undefined) {
      const tile = facts?.tiles.get(p.entity) ?? null;
      if (tile === null) continue; // position-less emitter → silent
      spatial = computeSpatial(tile.col, tile.row, camera, canvasW, canvasH);
      if (spatial !== null && p.kind === 'cue' && visibleTile?.(tile.col, tile.row) === false) continue;
    }
    if (spatial === null) {
      if (p.kind === 'stinger' && p.offScreenGain !== undefined) {
        shots.push(jingleShot(index, files, p.key, p.musicType, tense, p.offScreenGain));
      }
      continue; // off screen → silent
    }
    if (p.kind === 'stinger') {
      shots.push(jingleShot(index, files, p.key, p.musicType, tense));
    } else {
      shots.push({
        files,
        gain: spatial.gain * poolGain(index, files),
        pan: spatial.pan,
        key: p.key,
        lane: p.kind === 'scream' ? SCREAM_LANE : SFX_LANE,
        ...(p.exclusive !== undefined ? { exclusive: p.exclusive } : {}),
        ...(p.layer !== undefined ? { layer: p.layer } : {}),
      });
    }
  }
  return shots;
}
