/**
 * A minimal fake Web Audio context for exercising the impure `web/` layer headless through the
 * engine's injected `createContext`/`fetchBytes` seams. It records graph topology (what connected to
 * what), source lifecycle (started/stopped) and gain ramps, which is what the tests assert.
 */

export class FakeParam {
  value = 0;
  /** Every linearRamp target scheduled on this param, in order. */
  ramps: Array<{ value: number; time: number }> = [];
  cancelScheduledValues(): void {}
  setValueAtTime(value: number): void {
    this.value = value;
  }
  // Simplification: ramps complete instantly — `value` jumps straight to the target, so it is never
  // time-accurate mid-ramp. Assert on `ramps` (the scheduled targets), not on `value` over time.
  linearRampToValueAtTime(value: number, time: number): void {
    this.ramps.push({ value, time });
    this.value = value;
  }
}

export class FakeNode {
  readonly connectedTo: unknown[] = [];
  connect<T>(node: T): T {
    this.connectedTo.push(node);
    return node;
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
  started = false;
  stoppedAt: number | null = null;
  start(): void {
    this.started = true;
  }
  stop(at: number): void {
    this.stoppedAt = at;
  }
}

export class FakeContext {
  currentTime = 0;
  state: AudioContextState = 'suspended';
  destination = new FakeNode();
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
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
  async decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer> {
    return { length: bytes.byteLength } as unknown as AudioBuffer;
  }
  async resume(): Promise<void> {
    this.state = 'running';
  }
}

/** Let the load→decode→play promise chain settle. */
export const flush = (): Promise<unknown> => new Promise((r) => setTimeout(r, 0));
