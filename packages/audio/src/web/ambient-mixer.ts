import type { AmbientLoop } from '../data/types.js';
import type { SampleCache } from './sample-cache.js';

/**
 * The looping-ambient half of playback: reconcile the set of running terrain beds against each
 * frame's target — start new beds (fading in from silence), ramp existing ones toward their target
 * gain, and fade-and-stop departed ones — so a bed fades in as its terrain scrolls on screen and out
 * as it leaves. All ramps ride the audio clock (`ctx.currentTime`), never `Date.now`.
 */

/** Ambient beds fade in / out / between gains over this many seconds. */
export const AMBIENT_FADE_S = 0.6;

interface RunningLoop {
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
}

export class AmbientMixer {
  /** ambient bed name → its running loop. */
  private readonly loops = new Map<string, RunningLoop>();

  constructor(
    private readonly ctx: AudioContext,
    /** The node loops play into (the engine's master gain). */
    private readonly out: AudioNode,
    private readonly samples: SampleCache,
    /** Playback gate, re-checked when an async load lands (a mute can arrive while a wav is in flight). */
    private readonly canPlay: () => boolean,
  ) {}

  /** Reconcile the running loops to `target`: start the new, retune the kept, stop the departed. */
  reconcile(target: readonly AmbientLoop[]): void {
    const wanted = new Map<string, AmbientLoop>();
    for (const loop of target) wanted.set(loop.name, loop);
    // Stop beds that scrolled off screen (not in the target set).
    for (const [name, running] of this.loops) {
      if (!wanted.has(name)) this.stopLoop(name, running);
    }
    // Start new beds and ramp existing ones toward their target gain.
    for (const loop of wanted.values()) {
      const running = this.loops.get(loop.name);
      if (running === undefined) this.startLoop(loop);
      else this.fadeTo(running.gain, loop.gain);
    }
  }

  /** Fade out and stop every running loop (mute / teardown). */
  stopAll(): void {
    for (const [name, running] of this.loops) this.stopLoop(name, running);
  }

  private stopLoop(name: string, running: RunningLoop): void {
    this.fadeTo(running.gain, 0);
    try {
      running.source.stop(this.ctx.currentTime + AMBIENT_FADE_S);
    } catch {
      // Already stopped — nothing to do.
    }
    this.loops.delete(name);
  }

  private startLoop(loop: AmbientLoop): void {
    void this.samples.get(loop.file).then((buffer) => {
      // Re-check the gate: a mute (setEnabled(false)) can land while this first load is in flight, and
      // stopAll() only stops already-tracked loops — without this guard the bed would start audibly
      // AND never be reconciled away (the engine skips frames while muted).
      if (buffer === null || !this.canPlay() || this.loops.has(loop.name)) return;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(this.out);
      source.start();
      this.fadeTo(gain, loop.gain);
      this.loops.set(loop.name, { source, gain });
    });
  }

  private fadeTo(gain: GainNode, target: number): void {
    const now = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(target, now + AMBIENT_FADE_S);
  }
}
