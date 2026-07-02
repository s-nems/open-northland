import type { AmbientLoop, AudioFrame, OneShot } from '../data/types.js';

/**
 * The impure Web Audio playback sink — the only part of the package that touches an `AudioContext`,
 * `fetch`, or the DOM. It takes the pure {@link AudioFrame} the director decided and makes it audible:
 * fires debounced one-shots through a per-play gain+pan graph, and reconciles a set of looping ambient
 * beds to match the frame (cross-fading as terrain scrolls in and out). All timing rides the audio
 * clock (`ctx.currentTime`), never `Date.now`, so ramps stay sample-accurate.
 *
 * Browser autoplay policy: the context starts suspended and makes no sound until {@link resume} is
 * called from inside a user gesture — the app wires that to the first click/key. Before then, and on
 * any decode/fetch failure, playback is a graceful no-op (silence), never a throw.
 */

/** Options for {@link WebAudioEngine}. */
export interface AudioEngineOptions {
  /** URL prefix the wav files are served under (a file path is appended). Default `/sounds/`. */
  readonly baseUrl?: string;
  /** Overall output gain (0..1). Default {@link DEFAULT_MASTER_GAIN}. */
  readonly masterGain?: number;
}

/** Default overall output gain. */
export const DEFAULT_MASTER_GAIN = 0.8;
/** An identical one-shot key retriggers no sooner than this many seconds apart (anti machine-gun). */
export const ONE_SHOT_COOLDOWN_S = 0.12;
/** Ambient beds fade in / out / between gains over this many seconds. */
export const AMBIENT_FADE_S = 0.6;
/** Prune the one-shot cooldown map when it grows past this many entries (keys are per-entity, never reused). */
export const COOLDOWN_PRUNE_SIZE = 512;

interface RunningLoop {
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
}

export class WebAudioEngine {
  private readonly baseUrl: string;
  private readonly masterGainValue: number;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;
  /** file → decoded buffer (or an in-flight promise; a null result means load failed — don't retry). */
  private readonly buffers = new Map<string, AudioBuffer | null | Promise<AudioBuffer | null>>();
  /** one-shot key → last play time (audio clock seconds) for cooldown debounce. */
  private readonly lastPlayed = new Map<string, number>();
  /** ambient bed name → its running loop. */
  private readonly loops = new Map<string, RunningLoop>();

  constructor(options: AudioEngineOptions = {}) {
    this.baseUrl = options.baseUrl ?? '/sounds/';
    this.masterGainValue = options.masterGain ?? DEFAULT_MASTER_GAIN;
  }

  /** Whether the context has been started (a user gesture resumed it). */
  get started(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /**
   * Start (or resume) the audio context — must be called from within a user gesture the first time,
   * or the browser keeps it suspended. Creates the context lazily on first call. Safe to call repeatedly.
   */
  async resume(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx === null) return;
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch {
        // A browser that refuses to resume outside a gesture just stays silent — not an error.
      }
    }
  }

  /** Mute/unmute without tearing down state (departing loops are stopped on the next silent frame). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stopAllLoops();
  }

  /** Apply one decided frame: fire its one-shots and reconcile its ambient loops. */
  apply(frame: AudioFrame): void {
    if (!this.enabled) return;
    const ctx = this.ctx;
    if (ctx === null || ctx.state !== 'running' || this.master === null) return;
    for (const shot of frame.oneShots) this.playOneShot(ctx, shot);
    this.reconcileAmbient(ctx, frame.ambient);
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx !== null) return this.ctx;
    const Ctor =
      typeof globalThis.AudioContext !== 'undefined'
        ? globalThis.AudioContext
        : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor === undefined) return null; // no Web Audio (headless/unsupported) → silent
    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = this.masterGainValue;
    master.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    return ctx;
  }

  /** Fetch + decode a wav into an `AudioBuffer`, cached (null cached on failure so we never re-fetch). */
  private async load(ctx: AudioContext, file: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(file);
    if (cached !== undefined) return cached; // a resolved buffer, a cached-null failure, or an in-flight promise
    const promise = (async (): Promise<AudioBuffer | null> => {
      try {
        const res = await fetch(this.baseUrl + file);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = await res.arrayBuffer();
        const buffer = await ctx.decodeAudioData(bytes);
        this.buffers.set(file, buffer);
        return buffer;
      } catch {
        this.buffers.set(file, null); // remember the failure; a missing wav must not spam the network
        return null;
      }
    })();
    this.buffers.set(file, promise);
    return promise;
  }

  private playOneShot(ctx: AudioContext, shot: OneShot): void {
    const now = ctx.currentTime;
    const last = this.lastPlayed.get(shot.key);
    if (last !== undefined && now - last < ONE_SHOT_COOLDOWN_S) return;
    this.pruneCooldowns(now);
    this.lastPlayed.set(shot.key, now);
    if (shot.files.length === 0) return;
    // Randomness belongs here (impure), not in the pure director: pick one wav from the group.
    const file = shot.files[Math.floor(Math.random() * shot.files.length)] as string;
    void this.load(ctx, file).then((buffer) => {
      if (
        buffer === null ||
        !this.enabled ||
        this.ctx !== ctx ||
        ctx.state !== 'running' ||
        this.master === null
      ) {
        return;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = shot.gain;
      // StereoPannerNode is absent on some old `webkitAudioContext` builds; degrade to unpanned rather
      // than throwing inside this un-awaited promise (which would silently drop all positional SFX).
      const head = this.pannerFor(ctx, shot.pan) ?? source;
      if (head !== source) source.connect(head);
      head.connect(gain).connect(this.master);
      source.start();
    });
  }

  /** A `StereoPannerNode` set to `pan`, or null when the context can't make one (old webkit). */
  private pannerFor(ctx: AudioContext, pan: number): StereoPannerNode | null {
    if (typeof ctx.createStereoPanner !== 'function') return null;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    return panner;
  }

  /** Drop cooldown entries older than the cooldown window once the map grows — keys are never reused. */
  private pruneCooldowns(now: number): void {
    if (this.lastPlayed.size < COOLDOWN_PRUNE_SIZE) return;
    for (const [key, when] of this.lastPlayed) {
      if (now - when >= ONE_SHOT_COOLDOWN_S) this.lastPlayed.delete(key);
    }
  }

  private reconcileAmbient(ctx: AudioContext, target: readonly AmbientLoop[]): void {
    const wanted = new Map<string, AmbientLoop>();
    for (const loop of target) wanted.set(loop.name, loop);
    // Stop beds that scrolled off screen (not in the target set).
    for (const [name, running] of this.loops) {
      if (!wanted.has(name)) {
        this.fade(ctx, running.gain, 0);
        try {
          running.source.stop(ctx.currentTime + AMBIENT_FADE_S);
        } catch {
          // Already stopped — nothing to do.
        }
        this.loops.delete(name);
      }
    }
    // Start new beds and ramp existing ones toward their target gain.
    for (const loop of wanted.values()) {
      const running = this.loops.get(loop.name);
      if (running === undefined) this.startLoop(ctx, loop);
      else this.fade(ctx, running.gain, loop.gain);
    }
  }

  private startLoop(ctx: AudioContext, loop: AmbientLoop): void {
    if (this.master === null) return;
    void this.load(ctx, loop.file).then((buffer) => {
      // Re-check `enabled`: a mute (setEnabled(false)) can land while this first load is in flight, and
      // stopAllLoops() only stops already-tracked loops — without this guard the bed would start audibly
      // AND never be reconciled away (apply() early-returns while muted).
      if (
        buffer === null ||
        !this.enabled ||
        this.ctx !== ctx ||
        ctx.state !== 'running' ||
        this.master === null ||
        this.loops.has(loop.name)
      ) {
        return;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(this.master);
      source.start();
      this.fade(ctx, gain, loop.gain);
      this.loops.set(loop.name, { source, gain });
    });
  }

  private fade(ctx: AudioContext, gain: GainNode, target: number): void {
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(target, now + AMBIENT_FADE_S);
  }

  private stopAllLoops(): void {
    const ctx = this.ctx;
    for (const [name, running] of this.loops) {
      if (ctx !== null) {
        this.fade(ctx, running.gain, 0);
        try {
          running.source.stop(ctx.currentTime + AMBIENT_FADE_S);
        } catch {
          // Already stopped.
        }
      }
      this.loops.delete(name);
    }
  }
}
