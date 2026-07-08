import type { Camera } from '@vinland/render/data';
import type { SimEvent, WorldSnapshot } from '@vinland/sim';
import type { SoundIndex } from '../data/bank.js';
import type { VoiceClass } from '../data/bindings.js';
import { directAudio } from '../data/director.js';
import { onScreenSettlers } from '../data/settlers.js';
import type { AudioTerrain, SoundBindings } from '../data/types.js';
import { type AudioEngineOptions, WebAudioEngine } from './audio-engine.js';
import { ChatterEmitter } from './chatter.js';

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
  /** Wall-clock ms since the last update, driving the time-based voice-chatter rate; omit → no chatter. */
  readonly dtMs?: number;
}

/**
 * {@link SoundDriver} construction options — the engine's platform/tuning seams plus the chatter's
 * voice pools; the one `random` source feeds both.
 */
export interface SoundDriverOptions extends AudioEngineOptions {
  /** Voice pools per sex/age the settler-chatter layer draws from; default the viking pools. */
  readonly voicePools?: Readonly<Record<VoiceClass, readonly string[]>>;
  /** Classify a settler (`jobType` + `young`) → its voice class; default `vikingVoiceClass`. */
  readonly voiceClassOf?: (jobType: number | null, young: boolean) => VoiceClass;
}

/**
 * The app-facing audio façade: per frame, turn the world state into playback. Every concern lives in
 * its own unit and this class only composes them — the PURE decisions (which events sound, which
 * beds loop, who is on screen) in {@link directAudio} + {@link onScreenSettlers}, the STOCHASTIC
 * voice chatter in the {@link ChatterEmitter}, and the actual Web Audio playback in the
 * {@link WebAudioEngine}. This is the one object the app shell constructs and pumps.
 */
export class SoundDriver {
  private readonly engine: WebAudioEngine;
  private readonly chatter: ChatterEmitter;

  constructor(
    private readonly index: SoundIndex,
    private readonly bindings: SoundBindings,
    options: SoundDriverOptions = {},
  ) {
    this.engine = new WebAudioEngine(options);
    this.chatter = new ChatterEmitter(index, options);
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
    const frame = directAudio({
      events: input.events,
      snapshot: input.snapshot,
      camera: input.camera,
      canvasW: input.canvasW,
      canvasH: input.canvasH,
      index: this.index,
      bindings: this.bindings,
      ...(input.terrain !== undefined ? { terrain: input.terrain } : {}),
    });
    // Append the ambient settler-chatter voices (stochastic + time-based → owned by the emitter, not
    // the pure director). The settler scan is a thunk so a no-dt frame never pays it.
    const voices = this.chatter.update(input.dtMs ?? 0, () =>
      onScreenSettlers(input.snapshot, input.camera, input.canvasW, input.canvasH),
    );
    this.engine.apply(
      voices.length === 0 ? frame : { oneShots: [...frame.oneShots, ...voices], ambient: frame.ambient },
    );
  }
}
