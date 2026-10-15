import '../hud/dom/foundation.css';
import './movie.css';
import type { CampaignMovie } from '@open-northland/data';

/** The original's film frame, used while a movie names no size of its own. */
const DEFAULT_MOVIE_WIDTH = 640;
const DEFAULT_MOVIE_HEIGHT = 480;
/** Height kept free below the frame for the play and skip buttons. */
const CONTROLS_RESERVE_PX = 64;
/** The seek bar's keyboard step. */
const SEEK_STEP_S = 1;
const SECONDS_PER_MINUTE = 60;

/** Display pixels, never enlarged. A small viewport shrinks both dimensions by the same factor. */
export function movieSize(
  width: number,
  height: number,
  availableWidth: number,
  availableHeight: number,
): { width: number; height: number } {
  const scale = Math.max(0, Math.min(1, availableWidth / width, availableHeight / height));
  return { width: width * scale, height: height * scale };
}

/** `m:ss` of a film position; an unknown length reads as zero. */
export function movieClock(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(whole / SECONDS_PER_MINUTE);
  return `${minutes}:${String(whole % SECONDS_PER_MINUTE).padStart(2, '0')}`;
}

/** Silences the page's music at once and answers the call that brings it back. */
export type MusicSilencer = () => () => void;

/**
 * The music's silence over one film: taken once, given back once, whichever of end, skip, load failure
 * or cancellation comes first.
 */
export function movieMusicHold(silence: MusicSilencer | undefined): { release(): void } {
  let restore: (() => void) | null = silence?.() ?? null;
  return {
    release() {
      const pending = restore;
      restore = null;
      pending?.();
    },
  };
}

export interface MovieLabels {
  readonly skip: string;
  readonly play: string;
  readonly failed: string;
  readonly seek: string;
}

/**
 * A blocking DOM movie surface; owns its media and listeners until end, skip or cancellation. While a
 * film plays, `silenceMusic` holds the page's music silent.
 */
export function playCampaignMovie(
  movie: CampaignMovie | undefined,
  labels: MovieLabels,
  signal?: AbortSignal,
  silenceMusic?: MusicSilencer,
): Promise<void> {
  if (signal?.aborted === true) return Promise.resolve();
  return new Promise((resolve) => {
    const surface = document.createElement('dialog');
    surface.className = 'campaign-movie';
    surface.setAttribute('role', 'dialog');
    surface.setAttribute('aria-modal', 'true');
    surface.setAttribute('aria-label', labels.play);
    const video = document.createElement('video');
    if (movie !== undefined) video.src = movie.url;
    video.playsInline = true;
    video.preload = 'auto';
    const play = document.createElement('button');
    play.className = 'on-button';
    play.textContent = labels.play;
    play.hidden = true;
    const skip = document.createElement('button');
    skip.className = 'on-button';
    skip.textContent = labels.skip;
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const controls = document.createElement('div');
    controls.className = 'campaign-movie__controls';
    controls.append(play, skip, status);
    const seek = document.createElement('input');
    seek.type = 'range';
    seek.className = 'campaign-movie__seek-range';
    seek.min = '0';
    seek.max = '0';
    seek.step = String(SEEK_STEP_S);
    seek.value = '0';
    seek.disabled = true;
    seek.setAttribute('aria-label', labels.seek);
    const clock = document.createElement('span');
    clock.className = 'campaign-movie__clock';
    const seekRow = document.createElement('div');
    seekRow.className = 'campaign-movie__seek';
    seekRow.append(seek, clock);
    // The HUD scope lends the controls its tokens and button style; the black surface stays outside it.
    const frameHud = document.createElement('div');
    frameHud.className = 'on-hud';
    frameHud.append(seekRow);
    const frame = document.createElement('div');
    frame.className = 'campaign-movie__frame';
    frame.append(video, frameHud);
    const hud = document.createElement('div');
    hud.className = 'on-hud';
    hud.append(controls);
    surface.append(frame, hud);
    const previousFocus = document.activeElement;
    const music = movieMusicHold(movie === undefined ? undefined : silenceMusic);
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      music.release();
      window.removeEventListener('resize', resize);
      signal?.removeEventListener('abort', finish);
      video.pause();
      video.removeAttribute('src');
      video.load();
      surface.remove();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      resolve();
    };
    const resize = (): void => {
      const size = movieSize(
        movie?.width ?? DEFAULT_MOVIE_WIDTH,
        movie?.height ?? DEFAULT_MOVIE_HEIGHT,
        window.innerWidth,
        Math.max(0, window.innerHeight - CONTROLS_RESERVE_PX),
      );
      frame.style.width = `${size.width}px`;
      frame.style.height = `${size.height}px`;
    };
    const showPosition = (): void => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      seek.disabled = duration <= 0;
      seek.max = String(duration);
      seek.value = String(video.currentTime);
      seek.setAttribute('aria-valuetext', movieClock(video.currentTime));
      const progress = duration > 0 ? (video.currentTime / duration) * 100 : 0;
      seek.style.setProperty('--progress', `${progress}%`);
      clock.textContent = `${movieClock(video.currentTime)} / ${movieClock(duration)}`;
    };
    const attempt = (): void => {
      play.hidden = true;
      void video.play().catch(() => {
        if (!done) {
          play.hidden = false;
          play.focus();
        }
      });
    };
    play.addEventListener('click', attempt);
    skip.addEventListener('click', finish);
    seek.addEventListener('input', () => {
      video.currentTime = Number(seek.value);
      showPosition();
    });
    video.addEventListener('loadedmetadata', showPosition);
    video.addEventListener('durationchange', showPosition);
    video.addEventListener('timeupdate', showPosition);
    video.addEventListener('ended', finish);
    video.addEventListener('error', () => {
      if (done) return;
      music.release();
      status.textContent = labels.failed;
      play.hidden = true;
      seekRow.hidden = true;
    });
    surface.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish();
    });
    surface.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        finish();
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        const order = [seek, play, skip].filter(
          (control) => !control.disabled && !control.hidden && !(control === seek && seekRow.hidden),
        );
        const at = order.indexOf(document.activeElement as HTMLButtonElement | HTMLInputElement);
        const step = event.shiftKey ? order.length - 1 : 1;
        order[(at + step) % order.length]?.focus();
      }
    });
    signal?.addEventListener('abort', finish, { once: true });
    window.addEventListener('resize', resize);
    document.body.append(surface);
    surface.showModal();
    resize();
    showPosition();
    skip.focus();
    if (movie === undefined) {
      status.textContent = labels.failed;
      seekRow.hidden = true;
    } else attempt();
  });
}
