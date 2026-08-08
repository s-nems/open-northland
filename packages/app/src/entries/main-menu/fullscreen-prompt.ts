import { messages } from '../../i18n/index.js';
import {
  enterFullscreen,
  fullscreenControllable,
  fullscreenOptedOut,
  isFullscreen,
} from '../../view/fullscreen.js';

/**
 * The menu's fullscreen prompt. It exists only while the window is not fullscreen, and its own click is
 * the user gesture a browser demands; `bindDisplayMode` records the mode that click produces.
 */

export interface FullscreenPrompt {
  /** Re-reads the catalog; the prompt outlives the screen swap that follows a language change. */
  relabel(): void;
}

export function mountFullscreenPrompt(root: HTMLElement, params: URLSearchParams): FullscreenPrompt {
  if (!fullscreenControllable() || fullscreenOptedOut(params)) return { relabel: () => undefined };

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'main-menu__fullscreen';
  const icon = document.createElement('span');
  icon.className = 'main-menu__fullscreen-icon';
  const text = document.createElement('span');
  button.append(icon, text);

  const relabel = (): void => {
    text.textContent = messages().mainMenu.fullscreenPrompt;
  };
  relabel();

  button.addEventListener('click', () => void enterFullscreen());
  // Escape, the settings screen's display segment and the window manager all change the mode in
  // either direction without going through this click.
  const paint = (): void => {
    button.hidden = isFullscreen();
  };
  document.addEventListener('fullscreenchange', paint);
  paint();

  root.append(button);
  // Mounted off the edge and released a frame later, so the first windowed menu gets a slide. A later
  // return from fullscreen re-displays a button that is already in place, and it simply reappears.
  requestAnimationFrame(() => button.classList.add('is-in'));
  return { relabel };
}
