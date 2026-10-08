import type { AmbientLoop } from '../../data/types.js';
import type { RandomFn } from '../platform.js';
import { rampParam } from './ramps.js';
import type { SampleCache } from './sample-cache.js';

/**
 * The looping-ambient half of playback: reconcile the running terrain beds against each frame's
 * target - start new beds (fading in from silence), ramp existing ones toward their target gain and
 * pan, and fade-and-stop departed ones. All ramps ride the audio clock (`ctx.currentTime`), never
 * `Date.now`. A bed starts at a random point of its loop, so one that returns is not the same opening
 * bars again.
 */

/** Ambient beds fade in / out / between gains and pans over this many seconds. */
export const AMBIENT_FADE_S = 0.6;

interface RunningLoop {
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
  /** Null where the context cannot make a stereo panner (old webkit): the bed then plays centred. */
  readonly panner: StereoPannerNode | null;
  /** The gain and pan its running ramps head for. Re-ramping to the same target every frame would
   *  restart the fade from wherever it is, so it would never finish in {@link AMBIENT_FADE_S}. */
  target: number;
  targetPan: number;
}

export class AmbientMixer {
  /** ambient bed name → its running loop. */
  private readonly loops = new Map<string, RunningLoop>();
  /** The most recent reconcile target - the load callback's "is this bed still wanted?" check. */
  private lastTarget: ReadonlyMap<string, AmbientLoop> = new Map();

  constructor(
    private readonly ctx: AudioContext,
    /** The node loops play into (the engine's ambient bus). */
    private readonly out: AudioNode,
    private readonly samples: SampleCache,
    /** Playback gate, re-checked when an async load lands (a mute can arrive while a wav is in flight). */
    private readonly canPlay: () => boolean,
    /** The [0,1) source of a loop's start point. */
    private readonly random: RandomFn,
  ) {}

  /** Reconcile the running loops to `target`: start the new, retune the kept, stop the departed. */
  reconcile(target: readonly AmbientLoop[]): void {
    const wanted = new Map<string, AmbientLoop>();
    for (const loop of target) wanted.set(loop.name, loop);
    this.lastTarget = wanted;
    // Stop beds that scrolled off screen (not in the target set).
    for (const [name, running] of this.loops) {
      if (!wanted.has(name)) this.stopLoop(name, running);
    }
    // Start new beds and ramp existing ones toward their target gain.
    for (const loop of wanted.values()) {
      const running = this.loops.get(loop.name);
      if (running === undefined) {
        this.startLoop(loop);
        continue;
      }
      if (running.target !== loop.gain) {
        running.target = loop.gain;
        this.fadeTo(running.gain.gain, loop.gain);
      }
      if (running.panner !== null && running.targetPan !== loop.pan) {
        running.targetPan = loop.pan;
        this.fadeTo(running.panner.pan, loop.pan);
      }
    }
  }

  /** Fade out and stop every running loop (mute / teardown). */
  stopAll(): void {
    this.lastTarget = new Map(); // in-flight loads must not start into a muted mixer
    for (const [name, running] of this.loops) this.stopLoop(name, running);
  }

  private stopLoop(name: string, running: RunningLoop): void {
    this.fadeTo(running.gain.gain, 0);
    try {
      running.source.stop(this.ctx.currentTime + AMBIENT_FADE_S);
    } catch {
      // Already stopped - nothing to do.
    }
    this.loops.delete(name);
  }

  private startLoop(loop: AmbientLoop): void {
    void this.samples.get(loop.file).then((buffer) => {
      // Re-check the gates: a mute (setEnabled(false)) or a reconcile that dropped this bed (terrain
      // scrolled off before its first load landed) can arrive while the wav is in flight - an untracked
      // loop that started anyway would play unwanted until the next reconcile catches it.
      if (buffer === null || !this.canPlay() || this.loops.has(loop.name)) return;
      const current = this.lastTarget.get(loop.name);
      if (current === undefined) return; // departed while loading
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      // Silent at its start, so the bed takes its pan at once; later moves glide.
      const panner = typeof this.ctx.createStereoPanner === 'function' ? this.ctx.createStereoPanner() : null;
      if (panner === null) source.connect(gain);
      else {
        panner.pan.value = current.pan;
        source.connect(panner).connect(gain);
      }
      gain.connect(this.out);
      source.start(0, this.random() * buffer.duration);
      // Ramp to the current target gain, not the possibly stale one this load was requested with.
      this.fadeTo(gain.gain, current.gain);
      this.loops.set(loop.name, { source, gain, panner, target: current.gain, targetPan: current.pan });
    });
  }

  private fadeTo(param: AudioParam, target: number): void {
    rampParam(this.ctx, param, target, AMBIENT_FADE_S);
  }
}
