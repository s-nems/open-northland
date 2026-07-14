import { type Command, FOG_MODE } from '@open-northland/sim';
import { messages } from '../../i18n/index.js';
import { BUTTON_STYLE, el } from '../overlay.js';
import { ROW_STYLE, setButtonActive } from './chrome.js';

/**
 * A live-rule toggle widget for the admin panel — a DOM row plus a {@link refresh} that re-reads the sim's
 * current rule state. The needs toggle + fog switcher share this shape: they build a control, enqueue a
 * command on click (never touching sim state), and re-sync their highlight from the sanctioned read when the
 * panel opens (the mount value may predate a scene's own boot toggle, and another surface could flip it).
 */
export interface LiveToggle {
  readonly row: HTMLElement;
  /** Re-read the live rule and repaint the control (call whenever the admin panel opens). */
  refresh(): void;
}

/** The admin fog switcher's mode buttons — every `FOG_MODE` with a human label. */
const FOG_MODES = [
  { mode: FOG_MODE.OFF, key: 'off' },
  { mode: FOG_MODE.REVEAL, key: 'reveal' },
  { mode: FOG_MODE.RECON, key: 'recon' },
] as const;

/**
 * The global needs toggle ("wyłącz potrzeby" — user decision 2026-07-11): flips the sim's setNeedsEnabled
 * rule so test units don't starve mid-session. Scenes boot with needs off, maps on; the label tracks the
 * value just requested (the command applies next tick, well before another click can land).
 */
export function createNeedsToggle(deps: {
  readonly enqueue: (command: Command) => void;
  readonly needsEnabled: (() => boolean) | undefined;
}): LiveToggle {
  const needsButton = el('button', BUTTON_STYLE);
  const copy = messages().admin;
  let needsOn = deps.needsEnabled?.() ?? true;
  const paint = (): void => {
    needsButton.textContent = needsOn ? copy.needsOn : copy.needsOff;
    setButtonActive(needsButton, needsOn);
  };
  needsButton.addEventListener('click', () => {
    needsOn = !needsOn;
    deps.enqueue({ kind: 'setNeedsEnabled', enabled: needsOn });
    paint();
  });
  paint();
  const row = el('div', 'display:flex;gap:8px;align-items:center;margin-top:8px');
  row.append(el('span', 'opacity:0.8', copy.needsCaption));
  row.append(needsButton);
  return {
    row,
    refresh: () => {
      needsOn = deps.needsEnabled?.() ?? needsOn;
      paint();
    },
  };
}

/**
 * The fog-of-war mode switcher (the same live-rule pattern as the needs toggle): one button per
 * `FOG_MODE`, the active one highlighted from the sim's sanctioned read; a click enqueues `setFogMode`
 * and tracks the requested mode (applies next tick, before another click can land).
 */
export function createFogSwitcher(deps: {
  readonly enqueue: (command: Command) => void;
  readonly fogMode: (() => number) | undefined;
}): LiveToggle {
  const fogButtons: { readonly button: HTMLButtonElement; readonly mode: number }[] = [];
  let activeFogMode = deps.fogMode?.() ?? FOG_MODE.OFF;
  const paint = (): void => {
    for (const { button, mode } of fogButtons) setButtonActive(button, mode === activeFogMode);
  };
  const row = el('div', ROW_STYLE);
  const labels = messages().admin.fogModes;
  for (const { mode, key } of FOG_MODES) {
    const b = el('button', BUTTON_STYLE, labels[key]);
    b.addEventListener('click', () => {
      activeFogMode = mode;
      deps.enqueue({ kind: 'setFogMode', mode });
      paint();
    });
    fogButtons.push({ button: b, mode });
    row.append(b);
  }
  paint();
  return {
    row,
    refresh: () => {
      activeFogMode = deps.fogMode?.() ?? activeFogMode;
      paint();
    },
  };
}

/** A live switch for the building-footprint debug overlay. */
export function createGeometryToggle(deps: {
  readonly enabled: () => boolean;
  readonly setEnabled: (enabled: boolean) => void;
}): LiveToggle {
  const button = el('button', BUTTON_STYLE);
  const copy = messages().admin;
  let enabled = deps.enabled();
  const paint = (): void => {
    button.textContent = enabled ? copy.geometryOn : copy.geometryOff;
    setButtonActive(button, enabled);
  };
  button.addEventListener('click', () => {
    enabled = !enabled;
    deps.setEnabled(enabled);
    paint();
  });
  paint();
  return {
    row: button,
    refresh: () => {
      enabled = deps.enabled();
      paint();
    },
  };
}
