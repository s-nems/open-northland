import { messages } from '../../i18n/index.js';
import {
  enterFullscreen,
  fullscreenControllable,
  fullscreenOptedOut,
  isFullscreen,
} from '../../view/platform/fullscreen.js';

/**
 * The menu's fullscreen control in the screen's top-right corner. It exists only while the window is
 * not fullscreen, and its own click is the user gesture a browser demands; `bindDisplayMode` records
 * the mode that click produces.
 */

export interface FullscreenPrompt {
  /** Re-reads the catalog; the prompt outlives the screen swap that follows a language change. */
  relabel(): void;
}

export function mountFullscreenPrompt(
  root: HTMLElement,
  params: URLSearchParams,
  signal: AbortSignal,
): FullscreenPrompt {
  if (!fullscreenControllable() || fullscreenOptedOut(params)) return { relabel: () => undefined };

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'main-menu__fullscreen';
  const icon = document.createElement('span');
  icon.className = 'main-menu__fullscreen-icon';
  const text = document.createElement('span');
  button.append(icon, text);

  const relabel = (): void => {
    const copy = messages().mainMenu;
    text.textContent = copy.fullscreenButton;
    button.title = copy.fullscreenPrompt;
  };
  relabel();

  button.addEventListener('click', () => void enterFullscreen());
  // Escape, the settings screen's display segment and the window manager all change the mode in
  // either direction without going through this click.
  const paint = (): void => {
    button.hidden = isFullscreen();
  };
  document.addEventListener('fullscreenchange', paint, { signal });
  paint();

  root.append(button);
  // Mounted transparent and released a frame later, so the first windowed menu fades it in. A later
  // return from fullscreen re-displays a button that is already in place, and it simply reappears.
  requestAnimationFrame(() => button.classList.add('is-in'));
  return { relabel };
}
