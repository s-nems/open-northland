import { describe, expect, it } from 'vitest';
import { followPageFocus, type PageFocus } from '../src/view/sound-background.js';
import type { GestureSource } from '../src/view/sound-start.js';

class FakeEvents implements GestureSource {
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

class FakePage extends FakeEvents implements PageFocus {
  hidden = false;
  focused = true;
  hasFocus(): boolean {
    return this.focused;
  }
}

class FakeAudio {
  readonly reports: boolean[] = [];
  started = true;
  resumes = 0;
  setPageInBackground(inBackground: boolean): void {
    this.reports.push(inBackground);
  }
  resume(): Promise<void> {
    this.resumes++;
    this.started = true;
    return Promise.resolve();
  }
}

function follow(activation = { hasBeenActive: true }) {
  const page = new FakePage();
  const focusEvents = new FakeEvents();
  const audio = new FakeAudio();
  const scope = new AbortController();
  followPageFocus(audio, { page, focusEvents, activation, signal: scope.signal });
  return { page, focusEvents, audio, scope };
}

describe('followPageFocus', () => {
  it('reports the page state at once', () => {
    const { audio } = follow();
    expect(audio.reports).toEqual([false]);
  });

  it('reports a hidden tab and its return', () => {
    const { page, audio } = follow();
    page.hidden = true;
    page.fire('visibilitychange');
    page.hidden = false;
    page.fire('visibilitychange');
    expect(audio.reports).toEqual([false, true, false]);
  });

  it('reports an unfocused window as in the background', () => {
    const { page, focusEvents, audio } = follow();
    page.focused = false;
    focusEvents.fire('blur');
    page.focused = true;
    focusEvents.fire('focus');
    expect(audio.reports).toEqual([false, true, false]);
  });

  it('asks for a paused context back when the page returns', () => {
    const { page, audio } = follow();
    page.hidden = true;
    page.fire('visibilitychange');
    audio.started = false;
    expect(audio.resumes).toBe(0);
    page.hidden = false;
    page.fire('visibilitychange');
    expect(audio.resumes).toBe(1);
  });

  it('leaves a never-activated page to the first gesture', () => {
    const { page, audio } = follow({ hasBeenActive: false });
    audio.started = false;
    page.fire('visibilitychange');
    expect(audio.resumes).toBe(0);
  });

  it('drops its listeners when the audio ends', () => {
    const { page, focusEvents, scope } = follow();
    scope.abort();
    expect(page.bound + focusEvents.bound).toBe(0);
  });
});
