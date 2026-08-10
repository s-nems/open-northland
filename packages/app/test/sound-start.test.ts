import { describe, expect, it } from 'vitest';
import { type GestureSource, startSound } from '../src/view/runtime/sound-start.js';

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

describe('startSound', () => {
  it('starts at once when the document is already activated, without waiting for another gesture', async () => {
    const sound = new FakeSound();
    const gestures = new FakeGestures();
    startSound(sound, gestures, ACTIVATED);
    expect(sound.resumes).toBe(1);
    await Promise.resolve();
    expect(gestures.bound).toBe(0);
  });

  it('waits for the first gesture when the document has never been activated', async () => {
    const sound = new FakeSound();
    const gestures = new FakeGestures();
    startSound(sound, gestures, UNTOUCHED);
    expect(sound.resumes).toBe(0);
    gestures.fire('pointerdown');
    expect(sound.resumes).toBe(1);
    await Promise.resolve();
    expect(gestures.bound).toBe(0);
  });

  it('waits for a gesture where the browser reports no activation state', () => {
    const sound = new FakeSound();
    const gestures = new FakeGestures();
    startSound(sound, gestures, null);
    expect(sound.resumes).toBe(0);
    gestures.fire('keydown');
    expect(sound.resumes).toBe(1);
  });

  it('keeps listening while the context refuses to start, then stops once it runs', async () => {
    const sound = new FakeSound();
    sound.refuse = true;
    const gestures = new FakeGestures();
    startSound(sound, gestures, ACTIVATED);
    await Promise.resolve();
    expect(gestures.bound).toBeGreaterThan(0);
    sound.refuse = false;
    gestures.fire('pointerup');
    await Promise.resolve();
    expect(gestures.bound).toBe(0);
  });

  it('survives a driver whose resume rejects', async () => {
    const gestures = new FakeGestures();
    const failing = {
      started: false,
      resume: (): Promise<void> => Promise.reject(new Error('context cap reached')),
    };
    expect(() => {
      startSound(failing, gestures, ACTIVATED);
    }).not.toThrow();
    await Promise.resolve();
    expect(gestures.bound).toBeGreaterThan(0);
  });
});
