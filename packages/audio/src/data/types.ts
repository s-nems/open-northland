import type { VoiceClass } from '@open-northland/data';
import type { Camera, SceneGround } from '@open-northland/render/data';
import type { ChestKind, SimEvent, SimEventKind, WorldSnapshot } from '@open-northland/sim';
import type { AlertKind, NoticeVoice } from './alerts.js';
import type { SoundIndex } from './bank.js';
import type { AmbientBedMemory } from './director/ambient.js';
import type { LandscapeSectors } from './landscape-sectors.js';
import type { SoundBus } from './mixer.js';
import type { ShotLayer } from './perspective.js';
import type { UiCue } from './ui-cues.js';

/**
 * The audio package's pure vocabulary - the data the {@link import('./director/index.js').directAudio}
 * decision consumes and produces, with no Web Audio / DOM.
 */

/**
 * The arbitration lane a one-shot competes in ({@link import('./arbiter.js').OneShotArbiter}). A
 * `jingle` is a life-event stinger, identified by its `MusicType`; an `alert` shares its lane and
 * ranking (an attack horn, a settler's notice line); a `voice` is an unprompted line or a scream; `sfx`
 * is a positioned action sound; `ambience` is a landscape object's sound (a bird, a branch, a stone).
 * A shot without a lane always plays: a GUI cue answering the player's own input, or a settler
 * answering an order.
 */
export type Lane =
  | { readonly kind: 'jingle'; readonly musicType: number }
  | { readonly kind: 'alert'; readonly alert: AlertKind }
  | {
      readonly kind: 'voice';
      /** A struck body's scream, rationed apart from the chatter and calls sharing the voice lane. */
      readonly scream?: boolean;
    }
  | { readonly kind: 'sfx' }
  | { readonly kind: 'ambience' };

/** One resolved request to play a sound once. */
export interface OneShot {
  /** The group's interchangeable wav paths (relative to the sounds root). Shots of one group share the
   *  index's own array, which is how the arbiter knows the pool and picks the wav the engine plays. */
  readonly files: readonly string[];
  /** Final playback gain: the group's authored volume times its spatial attenuation, and for a world
   *  shot the arbiter's level variation, which may lift it a little past 1. */
  readonly gain: number;
  /** Stereo pan, -1 (hard left) .. +1 (hard right); 0 for non-spatial jingles. */
  readonly pan: number;
  /** Emitter identity for debounce/dedup (e.g. `"atomicSound:9:42"`). */
  readonly key: string;
  /** Milliseconds the music should stay ducked under this shot - set on a jingle, from its
   *  per-`MusicType` hold ({@link import('./bindings.js').JINGLE_DUCK_HOLD_MS}). */
  readonly duckMusicMs?: number;
  /** dB the music dips for {@link duckMusicMs}: the jingle type's depth scaled by the share it rings at
   *  ({@link import('./bindings.js').jingleDuck}). Absent is the original's full duck. */
  readonly jingleDuckDb?: number;
  /** dB the world and ambient buses dip for the length of this shot's wav - set on an alert. */
  readonly duckWorldDb?: number;
  /** dB the music bus dips for the length of this shot's wav - set on an order's answer
   *  ({@link import('./mixer.js').ANSWER_MUSIC_DUCK_DB}) and on an alert. */
  readonly duckMusicDb?: number;
  /**
   * The original's "is this wave running" guard. `wav`: skip while the wav this shot picked is still
   * sounding, as a positioned voice, call or body blow does. `group`: skip while any wav of `files` still
   * sounds, as an order's answer does. A shot without it (a house hit, a thud) layers freely.
   */
  readonly exclusive?: 'wav' | 'group';
  /** A murmur line on an answer wav: its play holds no wav, so no answer waits on it or cuts it. */
  readonly unheld?: boolean;
  /** The speaker's whole pool when `files` is only part of it (a selection's short lines): a
   *  group-exclusive shot waits while any wav of this pool sounds. Absent is `files`. */
  readonly poolFiles?: readonly string[];
  /** A line that a later group-exclusive shot over a pool holding its wav cuts short instead of waiting
   *  for: a selection's acknowledgement under the order the player gives next. */
  readonly yieldsToAnswer?: boolean;
  /** The lane this shot is rationed in; absent for a shot that must always play. */
  readonly lane?: Lane;
  /** The bus it plays on when its lane does not decide it: `responses` for a settler answering the
   *  player ({@link import('./mixer.js').oneShotBus}). */
  readonly bus?: SoundBus;
  /** The zoom layer a world shot fades in ({@link import('./perspective.js').shotLayer}); absent is
   *  `detail`. A shot off the `world` bus, or a preview, ignores it. */
  readonly layer?: ShotLayer;
  /** A settings slider's test clip: it plays straight into its bus, outside every zoom layer, so the
   *  slider is judged at the bus's own level wherever the camera was. */
  readonly preview?: boolean;
  /** The arbiter's handle for a world one-shot or a yielding line it started, which a later steal or
   *  answer names ({@link import('./one-shot-ledger.js').OneShotPlayback}). */
  readonly instance?: number;
  /** Playback rate, 1 = as recorded; the arbiter varies it per world one-shot. Absent plays at 1. */
  readonly rate?: number;
  /** Seconds after the decision the shot starts, so a group's answer staggers its layers. Absent is 0. */
  readonly delayS?: number;
  /** Seconds the shot's key stays cooling after it starts, for a line that must not repeat soon (a
   *  re-select, a murmur line). Absent is the ledger's anti machine-gun window. */
  readonly cooldownS?: number;
  /** A second key the shot waits on and cools, shared by a family of shots: any selection line, so a
   *  quick run of selections of different settlers speaks once. */
  readonly sharedCooldown?: { readonly key: string; readonly cooldownS: number };
  /** A shot outside every lane whose key cooldown grows like a jingle type's while it keeps firing, from
   *  {@link cooldownS}: a notice card the same settlement raises again and again. */
  readonly cooldownGrows?: boolean;
}

/**
 * One ambient bed that should be looping now at `gain`. The director returns the full active set each
 * frame; the engine reconciles its running loops to match.
 */
export interface AmbientLoop {
  /** The bed's name - its stable loop identity across frames (e.g. `"Meadow Green"`). */
  readonly name: string;
  /** The wav to loop for this bed (relative to the sounds root). */
  readonly file: string;
  /** Target loop gain, 0..1 (coverage-weighted: more of the screen = louder). */
  readonly gain: number;
  /** Stereo pan, -1..1, toward the half of the screen the bed's terrain fills. */
  readonly pan: number;
}

/** One frame's full audio decision: the one-shots to fire and the ambient loops that should be live. */
export interface AudioFrame {
  readonly oneShots: readonly OneShot[];
  readonly ambient: readonly AmbientLoop[];
}

/**
 * How a single sim event maps to a sound. A `spatial` binding names a {@link SoundBank} static group
 * that plays positioned at the event's world location (viewport-culled + attenuated + panned). A
 * `jingle` binding names a `MusicType` that plays as a life-event stinger (full gain, centred);
 * `screenGated` anchors the stinger to the event's world position so it rings only from the visible
 * screen. A `cue` binding plays one of the engine's hardwired wavs centred at full gain, as the GUI does.
 */
export type EventSound =
  | {
      readonly kind: 'spatial';
      readonly group: string;
      /** The zoom layer the sound fades in; absent is `detail`. */
      readonly layer?: ShotLayer;
    }
  | { readonly kind: 'cue'; readonly cue: UiCue }
  | {
      readonly kind: 'jingle';
      readonly musicType: number;
      /**
       * When set, the jingle rings only for the local player's own event, decided by the event's
       * `player` field; a `screenGated` jingle whose event carries none falls back to the emitter
       * entity's snapshot `Owner`. An unowned or undeterminable owner is silent - the safe default
       * for a notification sound.
       */
      readonly localPlayerOnly?: boolean;
      /**
       * When set, the jingle rings only while the event's position (`at` node or emitter entity) is
       * inside the viewport plus the spatial off-screen fade band; it keeps full gain and centre - the gate
       * decides audibility, not attenuation. An event whose position cannot be located stays silent.
       * Approximation: the original ships no audibility data (`soundfx.cif` has no range keys), so
       * screen-locality is a choice, not extracted behaviour.
       */
      readonly screenGated?: boolean;
      /** With `screenGated`: an event off screen rings at this share of the jingle's gain instead of
       *  staying silent. A position-less event stays silent. */
      readonly offScreenGain?: number;
    };

/** The sound of a settler's notice voice: a static group by name, or wavs the bank keeps in no group of
 *  their own. */
export type NoticeVoiceSound = { readonly group: string } | { readonly files: readonly string[] };

/**
 * The event→sound map the director resolves against, for the events whose sound is a choice made here.
 * An `atomicSound` needs no entry: it names its own group by `logicSoundType`, straight from the
 * animation's authored cue.
 */
export interface SoundBindings {
  readonly byEvent: Partial<Record<SimEventKind, EventSound>>;
  /** The original plays a kind-specific positioned lid sound in addition to the common open-chest
   *  jingle. Optional so synthetic/custom banks can leave chest opening silent. */
  readonly byChestKind?: Readonly<Record<ChestKind, EventSound>>;
  /** The static group the attack alert sounds; absent, an attack sounds no alert. */
  readonly attackAlert?: string;
  /** What each notice voice plays per voice class; a class left out stays silent. */
  readonly noticeVoices?: Readonly<Record<NoticeVoice, Partial<Record<VoiceClass, NoticeVoiceSound>>>>;
}

/** The row-major landscape grid the ambient layer samples (the terrain the snapshot is positioned over). */
export interface AudioTerrain {
  readonly width: number;
  readonly height: number;
  readonly typeIds: readonly number[];
  /** A decoded map's per-triangle ground patterns; the beds join by them instead of `typeIds`. */
  readonly ground?: SceneGround;
}

/** The object ambience's per-frame input: the rolls due and the map's scenery. The sim's standing
 *  objects come off the snapshot's indexes. */
export interface LandscapeInput {
  /** Rolls due this frame, the original's ticks elapsed on the audio clock
   *  ({@link import('./director/object-ambience.js').LandscapeRollClock}); 0 rolls nothing. */
  readonly rolls: number;
  /** The [0,1) roll source. */
  readonly random: () => number;
  /** The map's placed objects that are no sim entity (rocks, sirens, an ice wall), bucketed once. */
  readonly scenery?: LandscapeSectors;
}

/**
 * The unprompted creature voices' per-frame input: what the render drew and how many game ticks the
 * frame advanced, since the original rolls each once per game tick over the humans and animals it drew.
 */
export interface ChatterInput {
  /** The entity ids of the settlers and animals drawn this frame - the original's "seen" counters. */
  readonly drawn: () => Iterable<number>;
  /** Game ticks the sim advanced since the last frame; 0 on a paused or sub-tick frame rolls nothing. */
  readonly ticks: number;
  /** The [0,1) roll source - the pure layer's only randomness, injected per the package contract. */
  readonly random: () => number;
}

/** Settlers the player addressed at once, of whom the voices pick who speaks. */
export interface VoiceCall {
  readonly members: readonly number[];
  /** The GUI cue played instead when no member has a line to speak (a child, an animal, a building). */
  readonly fallback?: UiCue;
}

/** One order's addressees, answered as a group. */
export interface OrderAnswer extends VoiceCall {
  /** Every member refused the order (unreachable): the lead answers "no" instead of "ok". */
  readonly refused?: boolean;
}

/**
 * Everything one {@link import('./director/index.js').directAudio} call needs. `terrain` is optional -
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
  /** The orders the player gave since the last frame, answered together as one group. */
  readonly responses?: readonly OrderAnswer[];
  /** The latest selection the player took since the last frame, acknowledged by one member's voice. */
  readonly selection?: VoiceCall;
  /** The decoded length of a wav in seconds, or undefined while it is not decoded; picks the shortest
   *  line of a pool for the selection voice. Omit → the authored table alone decides. */
  readonly clipLengthS?: (file: string) => number | undefined;
  /** The idle chatter and animal calls' roll; omit for none (a gallery, a test of the event path). */
  readonly chatter?: ChatterInput;
  /** The landscape objects' ambience roll; omit for none. */
  readonly landscape?: LandscapeInput;
  /**
   * The player slot whose life-events are "ours" - gates an {@link EventSound.localPlayerOnly} jingle
   * to this player's own events. Omit → such a jingle never plays; a jingle without the flag is
   * unaffected.
   */
  readonly localPlayer?: number;
  /** The viewer's fog-of-war visibility at a fractional tile - gates an `atomicSound` (a settler hidden by
   *  the fog must not natter or hammer out of empty black). Omit → no fog, every on-screen cue is audible. */
  readonly visibleTile?: (col: number, row: number) => boolean;
  /** The local player is fighting, as the music's tense mood last read it; a jingle with a combat interval
   *  then rings sparingly and ducks nothing. Omit → calm. */
  readonly tense?: boolean;
  /** Whether the viewer ever explored the ground at a fractional tile - gates the terrain beds and the
   *  object ambience, since the explored grey still shows the land. Omit → no fog. */
  readonly exploredTile?: (col: number, row: number) => boolean;
  /** The bed choice's memory across frames; omit for the loudest beds as they rank this frame (a
   *  gallery, a test). */
  readonly beds?: AmbientBedInput;
}

/** What the ambient beds keep and read across frames. */
export interface AmbientBedInput {
  /** Audio-clock seconds, which a bed waiting for a slot is timed by. */
  readonly now: number;
  readonly memory: AmbientBedMemory;
  /** Bumps whenever {@link DirectorInput.exploredTile} may answer differently. With it, a framing that
   *  stands still reuses its sampled coverage; without it, a fogged ground is sampled every frame. */
  readonly fogRevision?: number;
}
