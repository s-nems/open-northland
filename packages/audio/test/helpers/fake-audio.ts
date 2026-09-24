/**
 * A minimal fake Web Audio context for exercising the impure `web/` layer headless through the
 * engine's injected `createContext`/`fetchBytes` seams. It records graph topology (what connected to
 * what), source lifecycle (started/stopped) and gain ramps, which is what the tests assert.
 */

/** One scheduled automation call, so a test can assert the anchor a ramp starts from and not only
 *  the target it ends on. */
export interface ParamEvent {
  readonly kind: 'set' | 'ramp' | 'cancel';
  readonly value: number;
  readonly time: number;
}

export class FakeParam {
  value = 0;
  /** Every linearRamp target scheduled on this param, in order. */
  ramps: Array<{ value: number; time: number }> = [];
  /** Every automation call in order, including the anchors and cancels `ramps` leaves out. */
  events: ParamEvent[] = [];
  cancelScheduledValues(time = 0): void {
    this.events.push({ kind: 'cancel', value: this.value, time });
  }
  setValueAtTime(value: number, time = 0): void {
    this.events.push({ kind: 'set', value, time });
    this.value = value;
  }
  // Simplification: ramps complete instantly - `value` jumps straight to the target, so it is never
  // time-accurate mid-ramp. Assert on `ramps` (the scheduled targets), not on `value` over time.
  linearRampToValueAtTime(value: number, time: number): void {
    this.ramps.push({ value, time });
    this.events.push({ kind: 'ramp', value, time });
    this.value = value;
  }
  exponentialRampToValueAtTime(value: number, time: number): void {
    this.linearRampToValueAtTime(value, time);
  }
}

export class FakeNode {
  readonly connectedTo: unknown[] = [];
  /** Set by {@link disconnect}, so a test can prove a finished track released its nodes. */
  disconnected = false;
  connect<T>(node: T): T {
    this.connectedTo.push(node);
    return node;
  }
  // `connectedTo` is left intact so a test can still read the graph a released node was part of.
  disconnect(): void {
    this.disconnected = true;
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam();
}

export class FakePanner extends FakeNode {
  pan = new FakeParam();
}

export class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  started = false;
  /** Context time the source was scheduled to open at, so a test can assert a silent gap. */
  startedAt = 0;
  stoppedAt: number | null = null;
  /** Seconds `start` limited playback to; null plays the buffer out. */
  playsForS: number | null = null;
  /** A test fires this to play the buffer out; a stop fires it too, as the real node does. */
  onended: (() => void) | null = null;
  start(at = 0, _offset = 0, duration?: number): void {
    this.started = true;
    this.startedAt = at;
    this.playsForS = duration ?? null;
  }
  stop(at: number): void {
    this.stoppedAt = at;
    this.onended?.();
  }
}

export class FakeContext {
  currentTime = 0;
  state: AudioContextState = 'suspended';
  destination = new FakeNode();
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  onstatechange: (() => void) | null = null;
  /** Resumes asked for, including the ones a suspension triggers without a gesture. */
  resumes = 0;
  /** Set to keep the context suspended through a resume, as a browser without user activation does. */
  refuseResume = false;
  /** Move to `state` and fire `statechange` when it changed, as the real context does. */
  setState(state: AudioContextState): void {
    if (this.state === state) return;
    this.state = state;
    this.onstatechange?.();
  }
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createStereoPanner(): FakePanner {
    return new FakePanner();
  }
  // One second of audio per fetched byte, so a test picks a track length by the buffer it serves.
  async decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer> {
    return { length: bytes.byteLength, duration: bytes.byteLength } as unknown as AudioBuffer;
  }
  async resume(): Promise<void> {
    this.resumes++;
    if (this.state !== 'closed' && !this.refuseResume) this.setState('running'); // a closed context never reopens
  }
  async close(): Promise<void> {
    this.setState('closed');
  }
}

/** Let the load→decode→play promise chain settle. */
export const flush = (): Promise<unknown> => new Promise((r) => setTimeout(r, 0));
