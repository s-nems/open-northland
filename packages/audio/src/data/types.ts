import type { Camera } from '@open-northland/render/data';
import type { SimEvent, SimEventKind, WorldSnapshot } from '@open-northland/sim';
import type { SoundIndex } from './bank.js';

/**
 * The audio package's pure vocabulary — the data the {@link import('./director/index.js').directAudio}
 * decision consumes and produces, with no Web Audio / DOM.
 */

/** One resolved request to play a sound once. */
export interface OneShot {
  /** The group's interchangeable wav paths (relative to the sounds root); the engine picks one. */
  readonly files: readonly string[];
  /** Final playback gain, 0..1 (spatial attenuation already applied; 1 for non-spatial jingles). */
  readonly gain: number;
  /** Stereo pan, -1 (hard left) .. +1 (hard right); 0 for non-spatial jingles. */
  readonly pan: number;
  /** Emitter identity for debounce/dedup (e.g. `"atomicCompleted:42"`). */
  readonly key: string;
}

/**
 * One ambient bed that should be looping now at `gain`. The director returns the full active set each
 * frame; the engine reconciles its running loops to match.
 */
export interface AmbientLoop {
  /** The bed's name — its stable loop identity across frames (e.g. `"Meadow Green"`). */
  readonly name: string;
  /** The wav to loop for this bed (relative to the sounds root). */
  readonly file: string;
  /** Target loop gain, 0..1 (coverage-weighted: more of the screen = louder). */
  readonly gain: number;
}

/** One frame's full audio decision: the one-shots to fire and the ambient loops that should be live. */
export interface AudioFrame {
  readonly oneShots: readonly OneShot[];
  readonly ambient: readonly AmbientLoop[];
}

/**
 * How a single sim event maps to a sound. A `spatial` binding names a {@link SoundBank} static group
 * that plays positioned at the event's world location (viewport-culled + attenuated + panned). A
 * `jingle` binding names a `MusicType` that plays non-spatially as a life-event stinger (full gain,
 * centred) — UI feedback, not world sound.
 */
export type EventSound =
  | { readonly kind: 'spatial'; readonly group: string }
  | {
      readonly kind: 'jingle';
      readonly musicType: number;
      /**
       * When set, the jingle plays only for a death of the local player's own unit — a notification, not
       * a world sound; a non-local or unowned (`null`) death is silent. Absent/false → it always plays (a
       * birth).
       */
      readonly localPlayerOnly?: boolean;
    };

/**
 * The event→sound map the director resolves against. `byEvent` covers events identified by their
 * kind alone; `byAtomic` covers `atomicCompleted`, whose meaning is the numeric `atomicId` (a
 * content-specific id — a chop vs. a hammer-swing), so the app keys it by the ids its content defines.
 */
export interface SoundBindings {
  readonly byEvent: Partial<Record<SimEventKind, EventSound>>;
  readonly byAtomic: ReadonlyMap<number, EventSound>;
  /**
   * The mid-swing sound of an atomic that plays its SFX on an authored PLAY_SOUND_FX frame, keyed by
   * `atomicId` — resolved for an `atomicSound` event (the sim's cue at that frame) rather than
   * `atomicCompleted`, so the sound lands on the visual strike, not the swing's end. An atomic with no
   * such cue keeps its completion-fired `byAtomic` sound.
   */
  readonly byAtomicSound: ReadonlyMap<number, EventSound>;
  /**
   * A melee `combatHit`'s weapon-specific impact sound, keyed by the striker's `weaponMainType`
   * (1 fist / 2 spear / 3 sword / 4 saber / 5 axe — `WEAPON_MAIN_TYPE_*`). A class with no entry (or a
   * hit that carries none) falls back to `byEvent.combatHit`. Optional — omit for no weapon-specific
   * impacts.
   */
  readonly byCombatWeapon?: ReadonlyMap<number, EventSound>;
}

/** The row-major landscape grid the ambient layer samples (the terrain the snapshot is positioned over). */
export interface AudioTerrain {
  readonly width: number;
  readonly height: number;
  readonly typeIds: readonly number[];
}

/**
 * Everything one {@link import('./director/index.js').directAudio} call needs. `terrain` is optional —
 * absent, no ambient plays.
 */
export interface DirectorInput {
  readonly events: readonly SimEvent[];
  readonly snapshot: WorldSnapshot;
  readonly camera: Camera;
  readonly canvasW: number;
  readonly canvasH: number;
  readonly terrain?: AudioTerrain;
  readonly index: SoundIndex;
  readonly bindings: SoundBindings;
  /**
   * The player slot whose life-events are "ours" — gates an {@link EventSound.localPlayerOnly} jingle
   * (the death stinger) to this player's own deaths. Omit → such a jingle never plays; a plain jingle (a
   * birth) is unaffected.
   */
  readonly localPlayer?: number;
  /** The viewer's fog-of-war visibility at a fractional tile — gates a `chatVoice` (a settler hidden by
   *  the fog must not natter from empty black). Omit → no fog, every on-screen chat is audible. */
  readonly visibleTile?: (col: number, row: number) => boolean;
}
