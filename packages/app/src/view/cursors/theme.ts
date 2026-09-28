import { diag } from '../../diag/index.js';
import { onStoredSettingsChange, readStoredSettings } from '../settings-store.js';
import { CURSOR_HOTSPOTS } from './hotspots.js';
import {
  type ArtCursorTheme,
  CURSOR_STATES,
  type CursorSize,
  type CursorState,
  type CursorTheme,
  cursorFallback,
} from './model.js';
import './cursors.css';

const images = import.meta.glob<string>('../../assets/ui/cursors/**/*.png', {
  eager: true,
  import: 'default',
  query: '?url&no-inline',
});

export function cursorImage(
  theme: ArtCursorTheme,
  state: CursorState,
  size: CursorSize,
  density = 1,
): string {
  const file = `../../assets/ui/cursors/${theme}/${state}-${size}${density === 2 ? '@2x' : ''}.png`;
  const url = images[file];
  if (url === undefined) throw new Error(`Missing cursor image: ${theme}/${state}/${size}/${density}`);
  return url;
}

export function cursorCss(
  theme: ArtCursorTheme,
  state: CursorState,
  size: CursorSize,
  retina: boolean,
): string {
  const [x, y] = CURSOR_HOTSPOTS[theme][size][state];
  const normal = `url("${cursorImage(theme, state, size)}")`;
  const source = retina ? `image-set(${normal} 1x, url("${cursorImage(theme, state, size, 2)}") 2x)` : normal;
  return `${source} ${x} ${y}, ${cursorFallback(state)}`;
}

/** One document owner survives menu/game handovers; changes do not depend on the render loop. */
export function installCursorTheme(): () => void {
  const root = document.documentElement;
  const retina = CSS.supports('cursor', 'image-set(url("data:image/png;base64,") 1x) 0 0, default');
  let currentTheme: CursorTheme | null = null;
  let currentSize: CursorSize | null = null;
  const property = (state: CursorState): string => `--cursor-${state === 'select' ? 'selection' : state}`;
  const clear = (): void => {
    for (const state of CURSOR_STATES) root.style.removeProperty(property(state));
  };
  const apply = (settings: { readonly cursorTheme: CursorTheme; readonly cursorSize: CursorSize }): void => {
    if (settings.cursorTheme === currentTheme && settings.cursorSize === currentSize) return;
    currentTheme = settings.cursorTheme;
    currentSize = settings.cursorSize;
    clear();
    if (currentTheme === 'system') return;
    try {
      for (const state of CURSOR_STATES) {
        root.style.setProperty(property(state), cursorCss(currentTheme, state, currentSize, retina));
      }
    } catch (error) {
      clear();
      diag.warn('ui', `Cursor theme unavailable: ${String(error)}`);
    }
  };
  const scope = new AbortController();
  const reset = (): void => {
    delete root.dataset.cursorButton;
  };
  const buttons = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') return;
    const next = (event.buttons & 2) !== 0 ? 'secondary' : (event.buttons & 1) !== 0 ? 'primary' : undefined;
    if (next === undefined) reset();
    else if (root.dataset.cursorButton !== next) root.dataset.cursorButton = next;
  };
  for (const name of ['pointerdown', 'pointerup', 'pointerover'] as const) {
    window.addEventListener(name, buttons, { capture: true, signal: scope.signal });
  }
  window.addEventListener('blur', reset, { signal: scope.signal });
  window.addEventListener('pointercancel', reset, { signal: scope.signal });
  const unsubscribe = onStoredSettingsChange(apply);
  apply(readStoredSettings());
  return () => {
    unsubscribe();
    scope.abort();
    reset();
    clear();
  };
}
