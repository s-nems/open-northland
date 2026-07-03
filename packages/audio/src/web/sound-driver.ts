import type { Camera } from '@vinland/render';
import type { SimEvent, WorldSnapshot } from '@vinland/sim';
import type { SoundIndex } from '../data/bank.js';
import { VIKING_VOICE_GROUPS } from '../data/bindings.js';
import { type AudioTerrain, directAudio, onScreenSettlers } from '../data/director.js';
import type { OneShot, SoundBindings } from '../data/types.js';
import { type AudioEngineOptions, WebAudioEngine } from './audio-engine.js';

/** Base gain of a settler voice (below SFX so chatter sits under the action, not over it). */
export const VOICE_GAIN = 0.7;
/** Target number of voice clips per second across the WHOLE on-screen crowd (scaled by, not per, settler). */
export const VOICE_RATE_PER_SEC = 1.6;
/** A given settler won't speak again for this long (ms) — so voices feel like people, not a loop. */
export const VOICE_COOLDOWN_MS = 4000;
/** Prune the per-settler speak-time map past this size (entities die/spawn; ids are never reused). */
export const VOICE_MAP_PRUNE_SIZE = 1024;

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

/** {@link SoundDriver} construction options — the engine's plus the voice-chatter pool. */
export interface SoundDriverOptions extends AudioEngineOptions {
  /** Voice groups the settler-chatter layer draws from; default {@link VIKING_VOICE_GROUPS}. Empty ⇒ no chatter. */
  readonly voiceGroups?: readonly string[];
}

/**
 * The app-facing audio façade: holds the resolved {@link SoundIndex} + {@link SoundBindings} and a
 * {@link WebAudioEngine}, and per frame turns the world state into playback via the pure
 * {@link directAudio} decision plus the stochastic settler voice chatter. This is the one object the
 * app shell constructs and pumps; everything game-specific (which sound answers which event) is in the
 * bindings, everything pure (what is on screen, how loud) is in the director, and everything impure
 * (the `AudioContext`, randomness) is here / in the engine.
 */
export class SoundDriver {
  private readonly engine: WebAudioEngine;
  private readonly voiceGroups: readonly string[];
  /** Fractional voice-clip budget carried between frames (a Poisson-ish emitter over `dtMs`). */
  private chatterBudget = 0;
  /** Monotonic driver clock (ms, summed from `dtMs`) for the per-settler voice cooldown. */
  private clockMs = 0;
  /** entity id → the clock time it last spoke, so one settler doesn't chatter continuously. */
  private readonly lastSpokeAt = new Map<number, number>();

  constructor(
    private readonly index: SoundIndex,
    private readonly bindings: SoundBindings,
    options: SoundDriverOptions = {},
  ) {
    this.engine = new WebAudioEngine(options);
    this.voiceGroups = options.voiceGroups ?? VIKING_VOICE_GROUPS;
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
    // Append the ambient settler-chatter voices (stochastic + time-based → owned here, not the pure director).
    const voices = this.pickChatter(input);
    this.engine.apply(
      voices.length === 0 ? frame : { oneShots: [...frame.oneShots, ...voices], ambient: frame.ambient },
    );
  }

  /**
   * Emit voice one-shots for on-screen settlers at ~{@link VOICE_RATE_PER_SEC} clips/second across the
   * visible crowd, each from a random settler (respecting its {@link VOICE_COOLDOWN_MS}) and a random
   * voice group/clip — so a crowd murmurs with real variety without any one settler looping. Purely
   * additive: no chatter when muted, when `dtMs` is absent, or when the crowd is off screen.
   */
  private pickChatter(input: SoundFrameInput): OneShot[] {
    const dtMs = input.dtMs ?? 0;
    if (dtMs <= 0 || this.voiceGroups.length === 0) return [];
    this.clockMs += dtMs;
    const settlers = onScreenSettlers(input.snapshot, input.camera, input.canvasW, input.canvasH);
    if (settlers.length === 0) return [];
    if (this.lastSpokeAt.size >= VOICE_MAP_PRUNE_SIZE) {
      for (const [id, when] of this.lastSpokeAt) {
        if (this.clockMs - when >= VOICE_COOLDOWN_MS) this.lastSpokeAt.delete(id);
      }
    }
    this.chatterBudget += (dtMs / 1000) * VOICE_RATE_PER_SEC;
    const shots: OneShot[] = [];
    while (this.chatterBudget >= 1) {
      this.chatterBudget -= 1;
      const settler = settlers[Math.floor(Math.random() * settlers.length)];
      if (settler === undefined) break;
      const last = this.lastSpokeAt.get(settler.entity);
      if (last !== undefined && this.clockMs - last < VOICE_COOLDOWN_MS) continue;
      const group = this.voiceGroups[Math.floor(Math.random() * this.voiceGroups.length)] as string;
      const files = this.index.groupsByName.get(group.toLowerCase());
      if (files === undefined || files.length === 0) continue;
      this.lastSpokeAt.set(settler.entity, this.clockMs);
      shots.push({
        files,
        gain: settler.gain * VOICE_GAIN,
        pan: settler.pan,
        key: `voice:${settler.entity}`,
      });
    }
    return shots;
  }
}
