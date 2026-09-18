import {
  type Command,
  FOG_MODE,
  type FogMode,
  type FogSettings,
  fogModeOf,
  fogSettings,
} from '@open-northland/sim';
import { messages } from '../../i18n/index.js';
import { BUTTON_STYLE, el } from '../overlay.js';
import { ROW_STYLE, setButtonActive } from './chrome.js';

/**
 * A live-rule toggle for the admin panel: a DOM row that enqueues a command on click, never touching sim
 * state, plus a refresh that re-syncs its highlight from the sim's own read.
 */
export interface LiveToggle {
  readonly row: HTMLElement;
  /** Re-read the live rule and repaint; the mount value may predate a scene's own boot toggle. */
  refresh(): void;
}

/** The debug menu's map row: the two lobby maps plus the revealed map (no fog at all) the lobby does
 *  not offer. */
const FOG_MAPS = [
  { key: 'off', terrainKnown: null },
  { key: 'classic', terrainKnown: false },
  { key: 'recon', terrainKnown: true },
] as const;

/**
 * The global needs toggle, so test units do not starve mid-session. Scenes boot with needs off, a map
 * with whatever the lobby chose; the label tracks the requested value, which the command applies next
 * tick.
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

/** A map row (revealed, classic, recon) over a fog-of-war toggle, the active picks highlighted from
 *  the sim's own read; the toggle is moot, and disabled, while the map is revealed. */
export function createFogSwitcher(deps: {
  readonly enqueue: (command: Command) => void;
  readonly fogMode: (() => FogMode) | undefined;
}): LiveToggle {
  const copy = messages().admin;
  let active = fogSettings(deps.fogMode?.() ?? FOG_MODE.OFF);
  const mapButtons: { readonly button: HTMLButtonElement; readonly terrainKnown: boolean | null }[] = [];
  const fogOfWarButton = el('button', BUTTON_STYLE);
  const paint = (): void => {
    for (const { button, terrainKnown } of mapButtons) {
      setButtonActive(button, terrainKnown === (active?.terrainKnown ?? null));
    }
    const fogOfWar = active?.fogOfWar === true;
    fogOfWarButton.textContent = fogOfWar ? copy.fogOfWarOn : copy.fogOfWarOff;
    fogOfWarButton.disabled = active === null;
    setButtonActive(fogOfWarButton, fogOfWar);
  };
  const request = (next: FogSettings | null): void => {
    active = next;
    deps.enqueue({ kind: 'setFogMode', mode: next === null ? FOG_MODE.OFF : fogModeOf(next) });
    paint();
  };
  const mapRow = el('div', ROW_STYLE);
  for (const { key, terrainKnown } of FOG_MAPS) {
    const button = el('button', BUTTON_STYLE, copy.fogModes[key]);
    button.addEventListener('click', () => {
      request(terrainKnown === null ? null : { terrainKnown, fogOfWar: active?.fogOfWar ?? false });
    });
    mapButtons.push({ button, terrainKnown });
    mapRow.append(button);
  }
  fogOfWarButton.addEventListener('click', () => {
    if (active !== null) request({ ...active, fogOfWar: !active.fogOfWar });
  });
  const fogOfWarRow = el('div', ROW_STYLE);
  fogOfWarRow.append(fogOfWarButton);
  const row = el('div', 'display:flex;flex-direction:column;gap:6px');
  row.append(mapRow, fogOfWarRow);
  paint();
  return {
    row,
    refresh: () => {
      if (deps.fogMode !== undefined) active = fogSettings(deps.fogMode());
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
