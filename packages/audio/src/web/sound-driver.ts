import type { Camera } from '@vinland/render';
import type { SimEvent, WorldSnapshot } from '@vinland/sim';
import type { SoundIndex } from '../data/bank.js';
import { type AudioTerrain, directAudio } from '../data/director.js';
import type { SoundBindings } from '../data/types.js';
import { type AudioEngineOptions, WebAudioEngine } from './audio-engine.js';

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
}

/**
 * The app-facing audio façade: holds the resolved {@link SoundIndex} + {@link SoundBindings} and a
 * {@link WebAudioEngine}, and per frame turns the world state into playback via the pure
 * {@link directAudio} decision. This is the one object the app shell constructs and pumps; everything
 * game-specific (which sound answers which event) is in the bindings, everything pure (what is on
 * screen, how loud) is in the director, and everything impure (the `AudioContext`) is in the engine.
 */
export class SoundDriver {
  private readonly engine: WebAudioEngine;

  constructor(
    private readonly index: SoundIndex,
    private readonly bindings: SoundBindings,
    options: AudioEngineOptions = {},
  ) {
    this.engine = new WebAudioEngine(options);
  }

  /** Start/resume audio — call from inside a user gesture (first click/key) to satisfy autoplay policy. */
  resume(): Promise<void> {
    return this.engine.resume();
  }

  /** Whether the audio context is running (a gesture has started it). */
  get started(): boolean {
    return this.engine.started;
  }

  /** Mute/unmute (also stops ambient loops while muted). */
  setEnabled(enabled: boolean): void {
    this.engine.setEnabled(enabled);
  }

  /** Decide + play one frame of audio from the current world state. */
  update(input: SoundFrameInput): void {
    // `terrain` is spread in only when present — `exactOptionalPropertyTypes` forbids passing `undefined`.
    this.engine.apply(
      directAudio({
        events: input.events,
        snapshot: input.snapshot,
        camera: input.camera,
        canvasW: input.canvasW,
        canvasH: input.canvasH,
        index: this.index,
        bindings: this.bindings,
        ...(input.terrain !== undefined ? { terrain: input.terrain } : {}),
      }),
    );
  }
}
