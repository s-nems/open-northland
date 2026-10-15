// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { movieClock, movieMusicHold, playCampaignMovie } from '../src/campaign/movie.js';

/** A film silences the page's music once and gives it back once, on every way the film ends. */

const LABELS = { play: 'Play', skip: 'Skip', failed: 'Failed', seek: 'Position' };
const MOVIE = { sequence: 0, url: '/campaigns/test/intro.webm', width: 640, height: 480 };

function silencer(): {
  readonly silence: () => () => void;
  readonly state: { taken: number; given: number };
} {
  const state = { taken: 0, given: 0 };
  return {
    state,
    silence: () => {
      state.taken++;
      return () => {
        state.given++;
      };
    },
  };
}

function surface(): HTMLDialogElement {
  const dialog = document.querySelector<HTMLDialogElement>('.campaign-movie');
  if (dialog === null) throw new Error('no movie surface');
  return dialog;
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = vi.fn();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('movieMusicHold', () => {
  it('takes the silence at once and gives it back only once', () => {
    const { silence, state } = silencer();
    const hold = movieMusicHold(silence);
    expect(state).toEqual({ taken: 1, given: 0 });
    hold.release();
    hold.release();
    expect(state).toEqual({ taken: 1, given: 1 });
  });

  it('is a no-op without a silencer', () => {
    expect(() => movieMusicHold(undefined).release()).not.toThrow();
  });
});

describe('playCampaignMovie music', () => {
  it('restores the music when the viewer skips', async () => {
    const { silence, state } = silencer();
    const done = playCampaignMovie(MOVIE, LABELS, undefined, silence);
    expect(state).toEqual({ taken: 1, given: 0 });
    surface().querySelectorAll('button')[1]?.click();
    await done;
    expect(state).toEqual({ taken: 1, given: 1 });
  });

  it('restores the music when the film ends', async () => {
    const { silence, state } = silencer();
    const done = playCampaignMovie(MOVIE, LABELS, undefined, silence);
    surface().querySelector('video')?.dispatchEvent(new Event('ended'));
    await done;
    expect(state).toEqual({ taken: 1, given: 1 });
  });

  it('restores the music as soon as the film fails to load, and only once', async () => {
    const { silence, state } = silencer();
    const done = playCampaignMovie(MOVIE, LABELS, undefined, silence);
    surface().querySelector('video')?.dispatchEvent(new Event('error'));
    expect(state).toEqual({ taken: 1, given: 1 });
    surface().querySelectorAll('button')[1]?.click();
    await done;
    expect(state).toEqual({ taken: 1, given: 1 });
  });

  it('restores the music when the caller aborts', async () => {
    const { silence, state } = silencer();
    const abort = new AbortController();
    const done = playCampaignMovie(MOVIE, LABELS, abort.signal, silence);
    abort.abort();
    await done;
    expect(state).toEqual({ taken: 1, given: 1 });
  });

  it('leaves the music alone when there is no film to play', async () => {
    const { silence, state } = silencer();
    const done = playCampaignMovie(undefined, LABELS, undefined, silence);
    surface().querySelectorAll('button')[1]?.click();
    await done;
    expect(state).toEqual({ taken: 0, given: 0 });
  });
});

describe('movieClock', () => {
  it('reads whole minutes and padded seconds', () => {
    expect(movieClock(0)).toBe('0:00');
    expect(movieClock(65.9)).toBe('1:05');
    expect(movieClock(Number.NaN)).toBe('0:00');
  });
});

describe('seek bar visibility', () => {
  it('shows the bar on pointer movement over the film, not on a resting pointer, and hides it on leave', () => {
    vi.useFakeTimers();
    try {
      const { silence } = silencer();
      void playCampaignMovie(MOVIE, LABELS, undefined, silence);
      const frame = surface().querySelector('.campaign-movie__frame');
      if (!(frame instanceof HTMLElement)) throw new Error('no frame');
      const pointing = 'campaign-movie__frame--pointing';
      expect(frame.classList.contains(pointing)).toBe(false);
      frame.dispatchEvent(new Event('pointermove', { bubbles: true }));
      expect(frame.classList.contains(pointing)).toBe(true);
      vi.advanceTimersByTime(3000);
      expect(frame.classList.contains(pointing)).toBe(false);
      frame.dispatchEvent(new Event('pointermove', { bubbles: true }));
      frame.dispatchEvent(new Event('pointerleave'));
      expect(frame.classList.contains(pointing)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
