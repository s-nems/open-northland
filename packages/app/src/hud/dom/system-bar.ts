import type { HudModel } from '@open-northland/render';
import { formatMessage, messages } from '../../i18n/index.js';
import { formatSimClock } from '../summary/model.js';
import { GAME_SPEED_STATES, type GameSpeedControl, type RunningGameSpeed } from '../tool-panel/game-speed.js';
import { menuArt } from './icons.js';
import { createObserverPicker, type ObserverPickerDeps } from './observer-picker.js';
import { setClass, setTitle } from './parts/dom.js';
import { createHudSummary, type HudSummaryDeps } from './summary.js';

const MENU_MEDALLION_PX = 34;
const MENU_ART_PX = 29;

/** How the speed segments read beside the player's control. `slowed` dims the pressed segment while
 *  the game runs below its request (a paced room, a local loop falling short), pressing `pressed`
 *  instead of the control's speed when set. `held` presses the pause and disables the bar while a
 *  relayed room waits for a member. The title says why. */
export type SpeedBarLook =
  | { readonly kind: 'slowed'; readonly title: string; readonly pressed: RunningGameSpeed | null }
  | { readonly kind: 'held'; readonly title: string };

export function sameSpeedBarLook(a: SpeedBarLook | null, b: SpeedBarLook | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind || a.title !== b.title) return false;
  return a.kind === 'held' || (b.kind === 'slowed' && a.pressed === b.pressed);
}

export interface HudSystemBarDeps {
  /** Set for a spectator: the seat picker leads the bar, before the seat's counters. */
  readonly observer?: ObserverPickerDeps | undefined;
  readonly summary: HudSummaryDeps;
  readonly onPauseToggle: () => void;
  readonly onSpeed: (running: RunningGameSpeed) => void;
  readonly onMenu: () => void;
}

/** The top-right bar, one panel: the summary counters, the sim clock, the pause and running-speed
 *  segments and the game-menu medallion. */
export interface HudSystemBar {
  /** Show the control as it stands; never pushes to the loop. */
  setSpeed(control: GameSpeedControl): void;
  /** Null restores the plain look. While `held`, a click on the bar does nothing. */
  setLook(look: SpeedBarLook | null): void;
  /** Show the tick's figures and clock; the same model twice costs nothing. */
  update(model: HudModel): void;
  /** Hang `node` just left of the bar, right-aligned to it on its vertical centre; null takes the hung
   *  node down. The bar owns the place, the caller the node. */
  setAside(node: HTMLElement | null): void;
  dispose(): void;
}

const isRunning = (state: string): state is RunningGameSpeed => state !== 'paused';

export function createHudSystemBar(plane: HTMLElement, deps: HudSystemBarDeps): HudSystemBar {
  const copy = messages().hud.shell;
  const bar = document.createElement('div');
  bar.className = 'on-bar on-bar--right on-panel';
  Object.assign(bar.style, { position: 'absolute', top: '0', right: '0' });

  const picker = deps.observer === undefined ? null : createObserverPicker(deps.observer);
  const summary = createHudSummary(deps.summary);

  const clock = document.createElement('time');
  clock.className = 'on-clock';
  clock.setAttribute('role', 'timer');
  const clockCopy = messages().hud.summary;
  let shownClock = '';

  const speed = document.createElement('div');
  speed.className = 'on-speed';
  speed.setAttribute('role', 'toolbar');
  speed.setAttribute('aria-label', copy.speedLabel);
  let control: GameSpeedControl | null = null;
  let look: SpeedBarLook | null = null;
  const segment = (label: string, onClick: () => void): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', label);
    button.addEventListener('click', () => {
      if (look?.kind !== 'held') onClick();
    });
    speed.append(button);
    return button;
  };
  const pause = segment(copy.pause, deps.onPauseToggle);
  pause.textContent = '❚❚';
  const running = new Map<RunningGameSpeed, HTMLButtonElement>();
  for (const spec of GAME_SPEED_STATES) {
    if (!isRunning(spec.state)) continue;
    const state = spec.state;
    const button = segment(formatMessage(copy.speed, { factor: spec.factor }), () => deps.onSpeed(state));
    button.textContent = `×${spec.factor}`;
    running.set(state, button);
  }

  const menu = document.createElement('button');
  menu.type = 'button';
  menu.className = 'on-medallion';
  menu.setAttribute('aria-label', copy.menu);
  Object.assign(menu.style, {
    width: `${MENU_MEDALLION_PX}px`,
    height: `${MENU_MEDALLION_PX}px`,
    marginLeft: '3px',
  });
  menu.innerHTML = menuArt(MENU_ART_PX);
  menu.addEventListener('click', deps.onMenu);

  // Out of the bar's flex row: it stands on the bar's left edge, whatever the counters' width.
  const aside = document.createElement('div');
  aside.className = 'on-bar__aside';

  if (picker !== null) bar.append(picker.element);
  bar.append(summary.element, clock, speed, menu, aside);
  plane.append(bar);
  const showSpeed = (): void => {
    if (control === null) return;
    const held = look?.kind === 'held';
    const paused = held || control.paused;
    const pressed = look?.kind === 'slowed' && look.pressed !== null ? look.pressed : control.running;
    pause.setAttribute('aria-pressed', String(paused));
    for (const [state, button] of running) {
      button.setAttribute('aria-pressed', String(!paused && pressed === state));
    }
    setClass(speed, 'on-speed--slowed', look?.kind === 'slowed');
    setClass(speed, 'on-speed--held', held);
    if (held) speed.setAttribute('aria-disabled', 'true');
    else speed.removeAttribute('aria-disabled');
    setTitle(speed, look?.title ?? '');
  };

  return {
    setSpeed: (next) => {
      control = next;
      showSpeed();
    },
    setLook: (next) => {
      if (sameSpeedBarLook(look, next)) return;
      look = next;
      showSpeed();
    },
    update: (model) => {
      picker?.refresh();
      summary.update(model);
      const text = formatSimClock(model.tick);
      if (text !== shownClock) {
        shownClock = text;
        clock.textContent = text;
        clock.setAttribute(
          'aria-label',
          formatMessage(clockCopy.count, { name: clockCopy.clock, count: text }),
        );
      }
    },
    setAside: (node) => {
      if (node === null) aside.replaceChildren();
      else if (aside.firstElementChild !== node) aside.replaceChildren(node);
    },
    dispose: () => {
      picker?.dispose();
      summary.dispose();
      bar.remove();
    },
  };
}
