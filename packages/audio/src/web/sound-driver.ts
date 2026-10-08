import type { Camera } from '@open-northland/render/data';
import type { SimEvent, WorldSnapshot } from '@open-northland/sim';
import { AlertDesk, type AttackReport, type NoticeVoice } from '../data/alerts.js';
import { OneShotArbiter } from '../data/arbiter.js';
import type { SoundIndex } from '../data/bank.js';
import { AmbientBedMemory } from '../data/director/ambient.js';
import { directAudio } from '../data/director/index.js';
import { type LandscapeSectors, type SceneryObject, scenerySectors } from '../data/landscape-sectors.js';
import type { MixerVolumes } from '../data/mixer.js';
import {
  CALM_MOOD,
  type MusicManifest,
  type MusicMoodState,
  MusicPlaylist,
  type MusicSequence,
  type MusicStanding,
  mapMusicFor,
  musicIntensity,
  nextMusicMood,
} from '../data/music/index.js';
import { PINNED_PRELOAD_TIERS, preloadPlan } from '../data/preload-plan.js';
import { countShots, emptySoundStats, type SoundStatsView } from '../data/sound-stats.js';
import type {
  AmbientLoop,
  AudioTerrain,
  OneShot,
  OrderAnswer,
  SoundBindings,
  VoiceCall,
} from '../data/types.js';
import { type NotificationCue, notificationShot, type UiCue, uiCueShot } from '../data/ui-cues.js';
import type { WeatherSoundInput } from '../data/weather/mix.js';
import { type AudioEngineOptions, type SoundPreloadReport, WebAudioEngine } from './engine/index.js';
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
  /** Whether the viewer ever explored the ground at a fractional tile - gates the terrain beds and the
   *  object ambience. Omit → no fog. */
  readonly exploredTile?: (col: number, row: number) => boolean;
  /** Bumps whenever `exploredTile` may answer differently, so a still camera reuses its bed sampling. */
  readonly fogRevision?: number;
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
  /** Attacks and notice voices reported since the last frame. */
  private readonly alerts = new AlertDesk();
  private readonly engine: WebAudioEngine;
  private readonly random: RandomFn;
  private readonly arbiter: OneShotArbiter;
  private playlist: MusicPlaylist | null = null;
  private mood: MusicMoodState = CALM_MOOD;
  /** Orders given since the last frame, answered with their settlers' voices on that frame. */
  private responses: OrderAnswer[] = [];
  /** The selection taken since the last frame, acknowledged on that frame. */
  private selection: VoiceCall | undefined;
  /** The sim tick the last frame stood at, so a frame knows how many ticks to roll the chatter for. */
  private lastTick: number | null = null;
  /** The map's sounding objects that are no sim entity, for the object ambience. */
  private scenery: LandscapeSectors | undefined;
  /** The ambient beds' choice across frames. */
  private readonly bedMemory = new AmbientBedMemory();
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
        stop: (instance, cause) => {
          if (cause === 'steal') this.counts.stolen++;
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

  /** Decode the bank ahead of play in {@link preloadPlan} order, starting once a gesture has created
   *  the context; resolves with what the cache holds, or null when audio never starts or the driver
   *  closes first. */
  preload(): Promise<SoundPreloadReport | null> {
    const samples = preloadPlan(this.index).map(({ file, tier }) => ({
      file,
      pinned: PINNED_PRELOAD_TIERS.has(tier),
    }));
    return this.engine.preload(samples);
  }

  /** The page went to the background or came back (see {@link WebAudioEngine.setPageInBackground}). */
  setPageInBackground(inBackground: boolean): void {
    this.engine.setPageInBackground(inBackground);
  }

  /** The "sound in background" setting (see {@link WebAudioEngine.setPlayInBackground}). */
  setPlayInBackground(play: boolean): void {
    this.engine.setPlayInBackground(play);
  }

  /** Fold the mix to mono (see {@link WebAudioEngine.setMono}). */
  setMono(mono: boolean): void {
    this.engine.setMono(mono);
  }

  /** Hand over the map's placed objects that are no sim entity; the object ambience keeps the ones
   *  with a sound. Call once per map. */
  setLandscapeScenery(objects: Iterable<SceneryObject>): void {
    this.scenery = scenerySectors(objects, (record) => this.index.landscapeAmbienceByRecord.has(record));
  }

  /** Mute/unmute (also stops ambient loops and music while muted). */
  setEnabled(enabled: boolean): void {
    this.engine.setEnabled(enabled);
  }

  /** Hand over the map's music: its playlist starts once audio is live, and each frame feeds it the
   *  mood. Null, or a code with no rendered music, stops the music. */
  setMusicMap(map: MusicMap | null): void {
    const music = map === null ? null : mapMusicFor(map.musicType, map.manifest);
    // The session runs on the audio clock, from the hand-over: the listener's time with this map's music.
    const startS = this.engine.clock;
    const sessionS = (): number => Math.max(0, this.engine.clock - startS);
    this.playlist =
      map === null || music === null ? null : new MusicPlaylist(music, map.manifest, this.random, sessionS);
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

  /** A notification arrived (a message card, a chat line, a player coming or going): ring its cue now.
   *  With `rateKey` (a message type), that key rings at most once per notice interval. */
  notify(notification: NotificationCue, rateKey?: string): void {
    if (!this.engine.audible) return;
    this.engine.fire(this.decide([notificationShot(notification, rateKey)], this.engine.clock));
  }

  /** The local seat was hit: the next frame, which knows the camera, decides whether the horn sounds. */
  alertAttack(report: AttackReport): void {
    if (this.engine.audible) this.alerts.reportAttack(report);
  }

  /** A settler's new notice speaks in its own voice on the next frame, once per notice interval. */
  noticeVoice(voice: NoticeVoice, settler: number): void {
    if (this.engine.audible) this.alerts.speak(voice, settler);
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

  /** The settlers the player just ordered answer as a group on the next frame, which knows where they
   *  stand and what they sound like. */
  respond(answer: OrderAnswer): void {
    this.responses.push(answer);
  }

  /** The selection the player just took is acknowledged on the next frame by one member's voice, or by
   *  the call's fallback cue; a later selection in the same frame replaces it. */
  select(call: VoiceCall): void {
    this.selection = call;
  }

  /** Decide + play one frame of audio from the current world state. */
  update(input: SoundFrameInput): void {
    const responses = this.responses;
    this.responses = [];
    const selection = this.selection;
    this.selection = undefined;
    const ticks = this.lastTick === null ? 0 : Math.max(0, input.snapshot.tick - this.lastTick);
    this.lastTick = input.snapshot.tick;
    // Before the audibility gate, so a camera zoomed while muted is already in the mix on unmute.
    this.engine.setCameraScale(input.camera.scale);
    // Suspended (no gesture yet) or muted: the engine would drop the frame unheard, so don't pay the
    // director decision work at all. A report queued before a mute would ring stale on unmute.
    if (!this.engine.audible) {
      this.alerts.clear();
      return;
    }
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
      ...(selection !== undefined ? { selection } : {}),
      clipLengthS: (file) => this.engine.clipLengthS(file),
      ...(input.drawnCreatures !== undefined
        ? { chatter: { drawn: input.drawnCreatures, ticks, random: this.random } }
        : {}),
      ...(input.terrain !== undefined ? { terrain: input.terrain } : {}),
      beds: {
        now: this.engine.clock,
        memory: this.bedMemory,
        ...(input.fogRevision !== undefined ? { fogRevision: input.fogRevision } : {}),
      },
      landscape: {
        ticks,
        random: this.random,
        ...(this.scenery !== undefined ? { scenery: this.scenery } : {}),
      },
      ...(input.localPlayer !== undefined ? { localPlayer: input.localPlayer } : {}),
      ...(input.visibleTile !== undefined ? { visibleTile: input.visibleTile } : {}),
      ...(input.exploredTile !== undefined ? { exploredTile: input.exploredTile } : {}),
      ...(musicIntensity(this.mood) === 'tense' ? { tense: true } : {}),
    });
    const now = this.engine.clock;
    const alerts = this.alerts.take(input, input.snapshot, this.index, this.bindings, now);
    const oneShots = alerts.length === 0 ? frame.oneShots : [...frame.oneShots, ...alerts];
    this.counts.frames++;
    this.engine.apply({ ...frame, oneShots: this.decide(oneShots, now) });
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
      intensity: musicIntensity(this.mood),
      stance: standing.stance,
      wealthy: this.mood.wealthy,
    });
    if (transition !== 'none') this.engine.transitionMusic(transition);
  }
}
