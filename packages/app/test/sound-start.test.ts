import { describe, expect, it } from 'vitest';
import { type GestureSource, startSound } from '../src/view/sound-start.js';

class FakeGestures implements GestureSource {
  readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set<() => void>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  get bound(): number {
    return [...this.listeners.values()].reduce((total, set) => total + set.size, 0);
  }

  fire(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
}

/** A driver that reports itself started once resumed, like the real context reaching `running`. */
class FakeSound {
  resumes = 0;
  started = false;
  /** Set to keep `started` false after a resume, as a browser that refuses to leave `suspended` does. */
  refuse = false;

  resume(): Promise<void> {
    this.resumes++;
    if (!this.refuse) this.started = true;
    return Promise.resolve();
  }
}

const ACTIVATED = { hasBeenActive: true };
const UNTOUCHED = { hasBeenActive: false };

const scope = (): AbortSignal => new AbortController().signal;

describe('startSound', () => {
  it('starts at once when the document is already activated, without waiting for another gesture', () => {
    const sound = new FakeSound();
    startSound(sound, { gestures: new FakeGestures(), activation: ACTIVATED, signal: scope() });
    expect(sound.resumes).toBe(1);
  });

  it('waits for the first gesture when the document has never been activated', () => {
    const sound = new FakeSound();
    const gestures = new FakeGestures();
    startSound(sound, { gestures, activation: UNTOUCHED, signal: scope() });
    expect(sound.resumes).toBe(0);
    gestures.fire('pointerdown');
    expect(sound.resumes).toBe(1);
  });

  it('waits for a gesture where the browser reports no activation state', () => {
    const sound = new FakeSound();
    const gestures = new FakeGestures();
    startSound(sound, { gestures, activation: null, signal: scope() });
    expect(sound.resumes).toBe(0);
    gestures.fire('keydown');
    expect(sound.resumes).toBe(1);
  });

  it('asks again on each gesture while the context refuses to start, and not once it runs', () => {
    const sound = new FakeSound();
    sound.refuse = true;
    const gestures = new FakeGestures();
    startSound(sound, { gestures, activation: ACTIVATED, signal: scope() });
    gestures.fire('pointerup');
    expect(sound.resumes).toBe(2);
    sound.refuse = false;
    gestures.fire('pointerup');
    gestures.fire('keydown');
    expect(sound.resumes).toBe(3);
  });

  it('brings back audio the platform suspended after it ran, on the next gesture', () => {
    const sound = new FakeSound();
    const gestures = new FakeGestures();
    startSound(sound, { gestures, activation: ACTIVATED, signal: scope() });
    sound.started = false; // a phone call or sleep suspended the running context
    gestures.fire('pointerdown');
    expect(sound.resumes).toBe(2);
    expect(sound.started).toBe(true);
  });

  it('stops listening for audio the page outlives, so a later gesture cannot revive it', () => {
    const sound = new FakeSound();
    const gestures = new FakeGestures();
    const lifetime = new AbortController();
    startSound(sound, { gestures, activation: UNTOUCHED, signal: lifetime.signal });
    lifetime.abort();
    expect(gestures.bound).toBe(0);
    gestures.fire('pointerdown');
    expect(sound.resumes).toBe(0);
  });

  it('survives a driver whose resume rejects', async () => {
    const gestures = new FakeGestures();
    const failing = {
      started: false,
      resume: (): Promise<void> => Promise.reject(new Error('context cap reached')),
    };
    expect(() => {
      startSound(failing, { gestures, activation: ACTIVATED, signal: scope() });
    }).not.toThrow();
    await Promise.resolve();
    expect(gestures.bound).toBeGreaterThan(0);
  });
});
