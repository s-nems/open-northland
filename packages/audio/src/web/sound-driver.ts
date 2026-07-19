import type { Camera } from '@open-northland/render/data';
import type { SimEvent, WorldSnapshot } from '@open-northland/sim';
import type { SoundIndex } from '../data/bank.js';
import { directAudio } from '../data/director/index.js';
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
  /** The local player slot — gates the death stinger to this player's own units; omit → it never rings. */
  readonly localPlayer?: number;
  /** The viewer's fog-of-war visibility at a fractional tile — gates the settler chat voices (a
   *  settler hidden by the fog must not natter from empty black). Omit → no fog, every chat is audible. */
  readonly visibleTile?: (col: number, row: number) => boolean;
}

/** {@link SoundDriver} construction options — the engine's platform/tuning seams. */
export interface SoundDriverOptions extends AudioEngineOptions {}

/**
 * The app-facing audio façade: per frame, turn the world state into playback. Every concern lives in its
 * own unit and this class only composes them — the pure decisions (which events sound, which beds loop)
 * in {@link directAudio}, and the Web Audio playback in the {@link WebAudioEngine}. Settler voices ride
 * the same event path: the sim's `chatVoice` cue (a chat clip's authored voice frame) is just another
 * spatialised one-shot, so voices come only from settlers actually talking on screen.
 */
export class SoundDriver {
  private readonly engine: WebAudioEngine;

  constructor(
    private readonly index: SoundIndex,
    private readonly bindings: SoundBindings,
    options: SoundDriverOptions = {},
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
    // Suspended (no gesture yet) or muted: the engine would drop the frame unheard, so don't pay the
    // director decision work at all.
    if (!this.engine.audible) return;
    // Optionals are spread in only when present — `exactOptionalPropertyTypes` forbids passing `undefined`.
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
  }
}
