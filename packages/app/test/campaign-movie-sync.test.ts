// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { MOVIE_SYNC_TOLERANCE_S, syncMovieSound } from '../src/campaign/movie-sync.js';

/** The silent picture leads a film; its language's sound track follows the picture's clock. */

interface FakeMedia {
  readonly element: HTMLMediaElement;
  readonly state: { currentTime: number; duration: number; paused: boolean; ended: boolean };
  readonly play: ReturnType<typeof vi.fn>;
  readonly pause: ReturnType<typeof vi.fn>;
}

const SHORT_S = 60;
const LONG_S = 63;

function fakeMedia(tag: 'video' | 'audio', duration: number, refuse = false): FakeMedia {
  const element = document.createElement(tag);
  const state = { currentTime: 0, duration, paused: true, ended: false };
  const play = vi.fn(() => {
    if (refuse) return Promise.reject(new Error('NotAllowedError'));
    state.paused = false;
    return Promise.resolve();
  });
  const pause = vi.fn(() => {
    state.paused = true;
  });
  Object.defineProperties(element, {
    currentTime: { get: () => state.currentTime, set: (value: number) => (state.currentTime = value) },
    duration: { get: () => state.duration },
    paused: { get: () => state.paused },
    ended: { get: () => state.ended },
    play: { value: play },
    pause: { value: pause },
  });
  return { element, state, play, pause };
}

function film(refuseSound = false) {
  const picture = fakeMedia('video', SHORT_S);
  const sound = fakeMedia('audio', LONG_S, refuseSound);
  const onEnd = vi.fn();
  return { picture, sound, onEnd, sync: syncMovieSound(picture.element, sound.element, onEnd) };
}

/** What a browser does at a track's natural end: the position rests on the end, paused, ended. */
function reachEnd(media: FakeMedia): void {
  Object.assign(media.state, { currentTime: media.state.duration, paused: true, ended: true });
  media.element.dispatchEvent(new Event('pause'));
  media.element.dispatchEvent(new Event('ended'));
}

describe('syncMovieSound', () => {
  it('mutes the picture and starts both together from the picture position', async () => {
    const { picture, sound, sync } = film();
    picture.state.currentTime = 3;
    await sync.play();
    expect(picture.element.muted).toBe(true);
    expect(picture.play).toHaveBeenCalledOnce();
    expect(sound.play).toHaveBeenCalledOnce();
    expect(sound.state.currentTime).toBe(3);
  });

  it('pauses both when either refuses to start', async () => {
    const { picture, sound, sync } = film(true);
    await expect(sync.play()).rejects.toThrow('NotAllowedError');
    expect(picture.state.paused).toBe(true);
    expect(sound.pause).toHaveBeenCalled();
  });

  it('treats a start interrupted by its own stall as no refusal', async () => {
    const { picture, sound, sync } = film();
    sound.play.mockImplementationOnce(() => Promise.reject(new DOMException('interrupted', 'AbortError')));
    await expect(sync.play()).resolves.toBeUndefined();
    expect(picture.state.paused).toBe(false);
  });

  it('resyncs the sound only when it drifts past the tolerance', async () => {
    const { picture, sound, sync } = film();
    await sync.play();
    picture.state.currentTime = 10;
    sound.state.currentTime = 10 - MOVIE_SYNC_TOLERANCE_S / 2;
    picture.element.dispatchEvent(new Event('timeupdate'));
    expect(sound.state.currentTime).toBe(10 - MOVIE_SYNC_TOLERANCE_S / 2);
    sound.state.currentTime = 10 - MOVIE_SYNC_TOLERANCE_S * 3;
    picture.element.dispatchEvent(new Event('timeupdate'));
    expect(sound.state.currentTime).toBe(10);
  });

  it('leaves a shorter sound track ended', async () => {
    const { picture, sound, sync } = film();
    await sync.play();
    sound.state.ended = true;
    sound.state.currentTime = 4;
    picture.state.currentTime = 5;
    picture.element.dispatchEvent(new Event('timeupdate'));
    expect(sound.state.currentTime).toBe(4);
  });

  it('seeks both and pauses both', async () => {
    const { picture, sound, sync } = film();
    await sync.play();
    sync.seek(42);
    expect([picture.state.currentTime, sound.state.currentTime]).toEqual([42, 42]);
    sync.pause();
    expect([picture.state.paused, sound.state.paused]).toEqual([true, true]);
  });

  it('holds the sound while the picture stalls and resumes it in place', async () => {
    const { picture, sound, sync } = film();
    await sync.play();
    picture.element.dispatchEvent(new Event('waiting'));
    expect(sound.state.paused).toBe(true);
    picture.state.currentTime = 7;
    picture.element.dispatchEvent(new Event('playing'));
    expect(sound.state).toMatchObject({ paused: false, currentTime: 7 });
  });

  it('stops following once disposed', async () => {
    const { picture, sound, sync } = film();
    await sync.play();
    sync.dispose();
    picture.state.currentTime = 30;
    picture.element.dispatchEvent(new Event('timeupdate'));
    picture.element.dispatchEvent(new Event('pause'));
    expect(sound.state).toMatchObject({ paused: false, currentTime: 0 });
  });

  it('holds the last frame while a longer sound plays on, and ends with the sound', async () => {
    const { picture, sound, onEnd, sync } = film();
    await sync.play();
    sound.state.currentTime = SHORT_S;
    reachEnd(picture);
    expect(sound.state.paused).toBe(false);
    expect(onEnd).not.toHaveBeenCalled();
    sound.state.currentTime = LONG_S - 1;
    expect(sync.position()).toBe(LONG_S - 1);
    reachEnd(sound);
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('plays the picture on to its end after a shorter sound ends', async () => {
    const picture = fakeMedia('video', LONG_S);
    const sound = fakeMedia('audio', SHORT_S);
    const onEnd = vi.fn();
    const sync = syncMovieSound(picture.element, sound.element, onEnd);
    await sync.play();
    picture.state.currentTime = SHORT_S;
    reachEnd(sound);
    expect(picture.state.paused).toBe(false);
    expect(onEnd).not.toHaveBeenCalled();
    reachEnd(picture);
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('closes at the picture end when the sound failed to load', async () => {
    const { picture, sound, onEnd, sync } = film();
    await sync.play();
    sound.element.dispatchEvent(new Event('error'));
    expect(onEnd).not.toHaveBeenCalled();
    reachEnd(picture);
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('spans the longer track and holds the last frame when seeked past the picture', async () => {
    const { picture, sound, sync } = film();
    expect(sync.duration()).toBe(LONG_S);
    await sync.play();
    sync.seek(SHORT_S + 1);
    expect([picture.state.currentTime, sound.state.currentTime]).toEqual([SHORT_S, SHORT_S + 1]);
    picture.element.dispatchEvent(new Event('seeking'));
    reachEnd(picture);
    sound.play.mockClear();
    picture.element.dispatchEvent(new Event('seeked'));
    expect(sound.play).toHaveBeenCalledOnce();
    expect(sound.state.currentTime).toBe(SHORT_S + 1);
    expect(sync.position()).toBe(SHORT_S + 1);
  });

  it('plays the held picture again when seeked back into it', async () => {
    const { picture, sync } = film();
    await sync.play();
    reachEnd(picture);
    picture.play.mockClear();
    sync.seek(SHORT_S / 2);
    expect(picture.play).toHaveBeenCalledOnce();
  });
});
