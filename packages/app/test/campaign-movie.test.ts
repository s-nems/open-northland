// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { movieClock, movieMusicHold, playCampaignMovie } from '../src/campaign/movie.js';

/** A film silences the page's music once and gives it back once, on every way the film ends. */

const LABELS = { play: 'Play', skip: 'Skip', failed: 'Failed', seek: 'Position' };
const MOVIE = {
  sequence: 0,
  url: '/campaigns/test/video/intro.webm',
  audio: '/campaigns/test/eng/intro.webm',
  width: 640,
  height: 480,
};

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

function tracks(): { video: HTMLVideoElement; sound: HTMLAudioElement } {
  const video = surface().querySelector('video');
  const sound = surface().querySelector('audio');
  if (video === null || sound === null) throw new Error('no film tracks');
  return { video, sound };
}

/** jsdom plays nothing; a track's natural end is its `ended` flag and event. */
function endTrack(element: HTMLMediaElement): void {
  Object.defineProperty(element, 'ended', { value: true });
  element.dispatchEvent(new Event('ended'));
}

/** Resolves to whether `done` settled by the next macrotask. */
async function settled(done: Promise<void>): Promise<boolean> {
  let resolved = false;
  void done.then(() => (resolved = true));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return resolved;
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

describe('playCampaignMovie media', () => {
  it('plays the shared picture muted beside the language sound track', async () => {
    void playCampaignMovie(MOVIE, LABELS);
    const video = surface().querySelector('video');
    expect(video?.getAttribute('src')).toBe(MOVIE.url);
    expect(video?.muted).toBe(true);
    expect(surface().querySelector('audio')?.getAttribute('src')).toBe(MOVIE.audio);
    await vi.waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2));
  });
});

describe('playCampaignMovie ending', () => {
  it('keeps the film, its picture on the last frame, until the longer sound ends', async () => {
    const done = playCampaignMovie(MOVIE, LABELS);
    const { video, sound } = tracks();
    endTrack(video);
    expect(await settled(done)).toBe(false);
    expect(video.isConnected).toBe(true);
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
    endTrack(sound);
    expect(await settled(done)).toBe(true);
  });

  it('keeps the film until the picture ends after a shorter sound', async () => {
    const done = playCampaignMovie(MOVIE, LABELS);
    const { video, sound } = tracks();
    endTrack(sound);
    expect(await settled(done)).toBe(false);
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
    endTrack(video);
    expect(await settled(done)).toBe(true);
  });

  it('ends both tracks at once on skip', async () => {
    const done = playCampaignMovie(MOVIE, LABELS);
    const { video, sound } = tracks();
    endTrack(video);
    surface().querySelectorAll('button')[1]?.click();
    await done;
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect([video.hasAttribute('src'), sound.hasAttribute('src')]).toEqual([false, false]);
    expect(video.isConnected).toBe(false);
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
    const { video, sound } = tracks();
    endTrack(video);
    endTrack(sound);
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
