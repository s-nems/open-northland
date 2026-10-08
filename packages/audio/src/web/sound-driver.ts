import type { Camera } from '@open-northland/render/data';
import type { SimEvent, WorldSnapshot } from '@open-northland/sim';
import { OneShotArbiter } from '../data/arbiter.js';
import type { SoundIndex } from '../data/bank.js';
import { directAudio } from '../data/director/index.js';
import type { MixerVolumes } from '../data/mixer.js';
import {
  CALM_MOOD,
  type MusicManifest,
  type MusicMoodState,
  type MusicSequence,
  MusicPlaylist,
  type MusicStanding,
  mapMusicFor,
  musicIntensity,
  nextMusicMood,
} from '../data/music/index.js';
import { countShots, emptySoundStats, type SoundStatsView } from '../data/sound-stats.js';
import type { AmbientLoop, AudioTerrain, OneShot, SoundBindings } from '../data/types.js';
import { type UiCue, uiCueShot } from '../data/ui-cues.js';
import type { WeatherSoundInput } from '../data/weather/mix.js';
import { type AudioEngineOptions, WebAudioEngine } from './engine/index.js';
import type { RandomFn } from './platform.js';

/** One frame's world state, handed to {@link SoundDriver.update} once per rendered frame. */
export interface SoundFrameInput {
  /** Every sim event since the last update (accumulate across all sim steps in the frame, not just the last tick). */
  readonly events: readonly SimEvent[];
  readonly snapshot: WorldSnapshot;
  readonly camera: Camera;
  readonly canvasW: number;
  readonly canvasH: number;
  /** The landscape grid, for the ambient layer; omit to skip ambient. */
  readonly terrain?: AudioTerrain;
  /** The local player slot - gates the life-event jingles to this player's own entities; omit → they
   *  never ring. */
  readonly localPlayer?: number;
  /** The viewer's fog-of-war visibility at a fractional tile - gates the settler animation cues (a
   *  settler hidden by the fog must not natter or hammer out of empty black). Omit → no fog. */
  readonly visibleTile?: (col: number, row: number) => boolean;
  /** The local settlement's standing, picking the map's own stems in its music rotation. Pulled only
   *  once a map has handed over its music, since the head-count behind it is an O(entities) read.
   *  Omit → the calm variant, which only a fight then moves. */
  readonly standingOf?: (snapshot: WorldSnapshot) => MusicStanding;
  /** The entity ids of the settlers and animals the renderer drew this frame, read only on a frame that
   *  advanced a game tick: the idle chatter and animal calls roll over them. Omit → no unprompted voices. */
  readonly drawnCreatures?: () => Iterable<number>;
}

/** The music a map authored: its `musictype` and what the pipeline rendered for it. */
export interface MusicMap {
  readonly musicType: number;
  readonly manifest: MusicManifest;
}

/** Standing for a frame that supplied none: no settlers counted, nobody hostile. */
const UNKNOWN_STANDING: MusicStanding = { population: 0, stance: 'neutral' };

/** {@link SoundDriver} construction options - the engine's platform/tuning seams. */
export interface SoundDriverOptions extends AudioEngineOptions {
  /** The [0,1) source of wav picks and chatter rolls - override in tests for determinism. Default
   *  `Math.random`. */
  readonly random?: RandomFn;
}

/**
 * The app-facing audio façade: per frame, turn the world state into playback. Every concern lives in its
 * own unit and this class only composes them - the pure decisions (which events sound, which beds loop)
 * in {@link directAudio}, how much of it the ear gets in the {@link OneShotArbiter}, and the Web Audio
 * playback in the {@link WebAudioEngine}. Settler action sounds
 * and voices ride one event path: the sim's `atomicSound` cue (an animation's authored sound frame) is
 * just another spatialised one-shot, so they come only from settlers actually working or talking on
 * screen.
 */
export class SoundDriver {
  private readonly engine: WebAudioEngine;
  private readonly random: RandomFn;
  private readonly arbiter: OneShotArbiter;
  private playlist: MusicPlaylist | null = null;
  private mood: MusicMoodState = CALM_MOOD;
  /** Settlers ordered since the last frame, answered with their voices on that frame. */
  private responses: number[] = [];
  /** The sim tick the last frame stood at, so a frame knows how many ticks to roll the chatter for. */
  private lastTick: number | null = null;
  /** One-shot counts since construction, for {@link stats}. */
  private readonly counts = emptySoundStats();

  constructor(
    private readonly index: SoundIndex,
    private readonly bindings: SoundBindings,
    options: SoundDriverOptions = {},
  ) {
    const engine = new WebAudioEngine(options);
    this.engine = engine;
    this.random = options.random ?? Math.random;
    this.arbiter = new OneShotArbiter({
      random: this.random,
      now: engine.clock,
      playback: {
        clipLengthS: (file) => engine.clipLengthS(file),
        stop: (instance) => {
          this.counts.stolen++;
          engine.stopOneShot(instance);
        },
      },
    });
  }

  close(): void {
    this.playlist = null;
    this.engine.close();
  }

  /** One-shot counts since construction (see {@link SoundStatsView}); a live view, so copy what a later
   *  read is compared against. */
  get stats(): SoundStatsView {
    return this.counts;
  }

  /** Start/resume audio - call from inside a user gesture (first click/key) to satisfy autoplay policy. */
  resume(): Promise<void> {
    return this.engine.resume();
  }

  /** Whether the audio context is running (a gesture has started it). */
  get started(): boolean {
    return this.engine.started;
  }

  /** Mute/unmute (also stops ambient loops and music while muted). */
  setEnabled(enabled: boolean): void {
    this.engine.setEnabled(enabled);
  }

  /** Hand over the map's music: its playlist starts once audio is live, and each frame feeds it the
   *  mood. Null, or a code with no rendered music, stops the music. */
  setMusicMap(map: MusicMap | null): void {
    const music = map === null ? null : mapMusicFor(map.musicType, map.manifest);
    this.playlist =
      map === null || music === null ? null : new MusicPlaylist(music, map.manifest, this.random);
    this.mood = CALM_MOOD;
    this.engine.setMusic(this.playlist);
  }

  /** Set the mixer's slider positions. */
  setVolumes(volumes: MixerVolumes): void {
    this.engine.setVolumes(volumes);
  }

  /** The `?sounds` gallery's frame: `shots` pass the arbiter as a game frame's would, `ambient` is the
   *  full set of beds to loop, and the world sounds as the camera at `cameraScale` hears it. */
  audition(shots: readonly OneShot[], ambient: readonly AmbientLoop[], cameraScale: number): void {
    this.engine.setCameraScale(cameraScale);
    if (!this.engine.audible) return;
    this.engine.apply({ oneShots: this.decide(shots, this.engine.clock), ambient });
  }

  /** The `?sounds` gallery's music: play `sequence` in place of any map's, or stop for null. */
  auditionMusic(sequence: MusicSequence | null): void {
    this.playlist = null;
    this.engine.setMusic(sequence);
  }

  /** The decoded length of `file` in seconds, or undefined until it has loaded. */
  clipLengthS(file: string): number | undefined {
    return this.engine.clipLengthS(file);
  }

  /** Once per rendered frame, after the render advanced its weather: the conditions on screen and the
   *  game seconds they advanced by (frozen while paused, so no new thunder rolls; the rain bed keeps
   *  sounding). Null conditions fade the weather out. */
  updateWeather(conditions: WeatherSoundInput | null, gameSeconds: number): void {
    this.engine.applyWeather(conditions, gameSeconds);
  }

  /** The graphics "Weather" switch (live). */
  setWeatherEnabled(enabled: boolean): void {
    this.engine.setWeatherEnabled(enabled);
  }

  /** Play a GUI cue now, from the input event itself: a button press confirms, a cancelled tool fails. */
  cue(cue: UiCue): void {
    if (!this.engine.audible) return;
    this.engine.fire(this.decide([uiCueShot(cue)], this.engine.clock));
  }

  /** A settler the player just ordered answers "ok" in its own voice on the next frame, which knows
   *  where it stands and what it sounds like. */
  respond(settler: number): void {
    this.responses.push(settler);
  }

  /** Decide + play one frame of audio from the current world state. */
  update(input: SoundFrameInput): void {
    const responses = this.responses;
    this.responses = [];
    const ticks = this.lastTick === null ? 0 : Math.max(0, input.snapshot.tick - this.lastTick);
    this.lastTick = input.snapshot.tick;
    // Before the audibility gate, so a camera zoomed while muted is already in the mix on unmute.
    this.engine.setCameraScale(input.camera.scale);
    // Suspended (no gesture yet) or muted: the engine would drop the frame unheard, so don't pay the
    // director decision work at all.
    if (!this.engine.audible) return;
    // Optionals are spread in only when present - `exactOptionalPropertyTypes` forbids passing `undefined`.
    const frame = directAudio({
      events: input.events,
      snapshot: input.snapshot,
      camera: input.camera,
      canvasW: input.canvasW,
      canvasH: input.canvasH,
      index: this.index,
      bindings: this.bindings,
      responses,
      ...(input.drawnCreatures !== undefined
        ? { chatter: { drawn: input.drawnCreatures, ticks, random: this.random } }
        : {}),
      ...(input.terrain !== undefined ? { terrain: input.terrain } : {}),
      ...(input.localPlayer !== undefined ? { localPlayer: input.localPlayer } : {}),
      ...(input.visibleTile !== undefined ? { visibleTile: input.visibleTile } : {}),
    });
    this.counts.frames++;
    this.engine.apply({ ...frame, oneShots: this.decide(frame.oneShots, this.engine.clock) });
    this.updateMusic(input);
  }

  /** The arbiter's decision on `shots`, counted per lane on the way in and out. */
  private decide(shots: readonly OneShot[], now: number): OneShot[] {
    countShots(this.counts.offered, shots);
    const started = this.arbiter.decide(shots, now);
    countShots(this.counts.started, started);
    return started;
  }

  /** Feed the playlist this frame's mood; only a change between calm and tense moves the player. */
  private updateMusic(input: SoundFrameInput): void {
    const playlist = this.playlist;
    if (playlist === null) return;
    const standing = input.standingOf?.(input.snapshot) ?? UNKNOWN_STANDING;
    this.mood = nextMusicMood(this.mood, {
      events: input.events,
      snapshot: input.snapshot,
      standing,
      ...(input.localPlayer !== undefined ? { localPlayer: input.localPlayer } : {}),
    });
    const transition = playlist.update({
      intensity: musicIntensity(this.mood, input.snapshot.tick),
      stance: standing.stance,
      wealthy: this.mood.wealthy,
    });
    if (transition !== 'none') this.engine.transitionMusic(transition);
  }
}
