import '../hud/dom/foundation.css';
import './movie.css';
import type { CampaignMovie } from '@open-northland/data';

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

export interface MovieLabels {
  readonly skip: string;
  readonly play: string;
  readonly failed: string;
}

/** A blocking DOM movie surface; owns its media and listeners until end, skip or cancellation. */
export function playCampaignMovie(
  movie: CampaignMovie | undefined,
  labels: MovieLabels,
  signal?: AbortSignal,
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
    // The HUD scope lends the controls its button style; the black surface stays outside it.
    const hud = document.createElement('div');
    hud.className = 'on-hud';
    hud.append(controls);
    surface.append(video, hud);
    const previousFocus = document.activeElement;
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
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
        movie?.width ?? 640,
        movie?.height ?? 480,
        window.innerWidth,
        Math.max(0, window.innerHeight - 64),
      );
      video.style.width = `${size.width}px`;
      video.style.height = `${size.height}px`;
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
    video.addEventListener('ended', finish);
    video.addEventListener('error', () => {
      status.textContent = labels.failed;
      play.hidden = true;
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
        (play.hidden || document.activeElement === play ? skip : play).focus();
      }
    });
    signal?.addEventListener('abort', finish, { once: true });
    window.addEventListener('resize', resize);
    document.body.append(surface);
    surface.showModal();
    resize();
    skip.focus();
    if (movie === undefined) status.textContent = labels.failed;
    else attempt();
  });
}
