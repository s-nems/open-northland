import type { Camera } from '@open-northland/render/data';
import type { SimEvent, WorldSnapshot } from '@open-northland/sim';
import type { SoundIndex } from '../data/bank.js';
import { directAudio } from '../data/director/index.js';
import {
  CALM_MOOD,
  type MusicManifest,
  type MusicMoodState,
  type MusicStanding,
  musicTrackFor,
  nextMusicMood,
} from '../data/music/index.js';
import type { AudioTerrain, SoundBindings } from '../data/types.js';
import { type AudioEngineOptions, WebAudioEngine } from './engine/index.js';

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
  /** The local settlement's standing, picking the mood variant of the map's music. Pulled only once a
   *  map has handed over its music, since the head-count behind it is an O(entities) read. Omit → the
   *  calm variant, which only a fight then moves. */
  readonly standingOf?: (snapshot: WorldSnapshot) => MusicStanding;
}

/** The music a map authored: its `musictype` and what the pipeline rendered for it. */
export interface MusicMap {
  readonly musicType: number;
  readonly manifest: MusicManifest;
}

/** Standing for a frame that supplied none: no settlers counted, nobody hostile. */
const UNKNOWN_STANDING: MusicStanding = { population: 0, stance: 'neutral' };

/** {@link SoundDriver} construction options - the engine's platform/tuning seams. */
export interface SoundDriverOptions extends AudioEngineOptions {}

/**
 * The app-facing audio façade: per frame, turn the world state into playback. Every concern lives in its
 * own unit and this class only composes them - the pure decisions (which events sound, which beds loop)
 * in {@link directAudio}, and the Web Audio playback in the {@link WebAudioEngine}. Settler action sounds
 * and voices ride one event path: the sim's `atomicSound` cue (an animation's authored sound frame) is
 * just another spatialised one-shot, so they come only from settlers actually working or talking on
 * screen.
 */
export class SoundDriver {
  private readonly engine: WebAudioEngine;
  private musicMap: MusicMap | null = null;
  private mood: MusicMoodState = CALM_MOOD;

  constructor(
    private readonly index: SoundIndex,
    private readonly bindings: SoundBindings,
    options: SoundDriverOptions = {},
  ) {
    this.engine = new WebAudioEngine(options);
  }

  close(): void {
    this.musicMap = null;
    this.engine.close();
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

  /** Release the audio context for good; a view that hands the document to another one calls this. */
  close(): void {
    this.engine.close();
  }

  /** Hand over the map's music, after which each frame picks its mood variant. Null stops choosing
   *  and leaves the running track alone. */
  setMusicMap(map: MusicMap | null): void {
    this.musicMap = map;
    this.mood = CALM_MOOD;
  }

  /** Set the game-sounds volume (0..1). */
  setSfxVolume(volume: number): void {
    this.engine.setSfxVolume(volume);
  }

  /** Set the music volume (0..1). */
  setMusicVolume(volume: number): void {
    this.engine.setMusicVolume(volume);
  }

  /** Decide + play one frame of audio from the current world state. */
  update(input: SoundFrameInput): void {
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
      ...(input.terrain !== undefined ? { terrain: input.terrain } : {}),
      ...(input.localPlayer !== undefined ? { localPlayer: input.localPlayer } : {}),
      ...(input.visibleTile !== undefined ? { visibleTile: input.visibleTile } : {}),
    });
    this.engine.apply(frame);
    this.updateMusic(input);
  }

  /** Re-decide the map's mood variant. The player reconciles by file, so re-asking for the track
   *  already playing every frame is free. */
  private updateMusic(input: SoundFrameInput): void {
    const map = this.musicMap;
    if (map === null) return;
    const standing = input.standingOf?.(input.snapshot) ?? UNKNOWN_STANDING;
    this.mood = nextMusicMood(this.mood, {
      events: input.events,
      snapshot: input.snapshot,
      standing,
      ...(input.localPlayer !== undefined ? { localPlayer: input.localPlayer } : {}),
    });
    this.engine.setMusic(
      musicTrackFor(map.musicType, standing.stance, this.mood, input.snapshot.tick, map.manifest),
    );
  }
}
