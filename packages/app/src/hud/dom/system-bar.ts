import type { HudModel } from '@open-northland/render';
import { formatMessage, messages } from '../../i18n/index.js';
import { formatSimClock } from '../summary/model.js';
import { GAME_SPEED_STATES, type GameSpeedControl, type RunningGameSpeed } from '../tool-panel/game-speed.js';
import { menuArt } from './icons.js';
import { createHudSummary, type HudSummaryDeps } from './summary.js';

const MENU_MEDALLION_PX = 34;
const MENU_ART_PX = 29;

export interface HudSystemBarDeps {
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
  /** Show the tick's figures and clock; the same model twice costs nothing. */
  update(model: HudModel): void;
  dispose(): void;
}

const isRunning = (state: string): state is RunningGameSpeed => state !== 'paused';

export function createHudSystemBar(plane: HTMLElement, deps: HudSystemBarDeps): HudSystemBar {
  const copy = messages().hud.shell;
  const bar = document.createElement('div');
  bar.className = 'on-bar on-bar--right on-panel';
  Object.assign(bar.style, { position: 'absolute', top: '0', right: '0' });

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
  const segment = (label: string, onClick: () => void): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', label);
    button.addEventListener('click', onClick);
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

  bar.append(summary.element, clock, speed, menu);
  plane.append(bar);
  return {
    setSpeed: (control) => {
      pause.setAttribute('aria-pressed', String(control.paused));
      for (const [state, button] of running) {
        button.setAttribute('aria-pressed', String(!control.paused && control.running === state));
      }
    },
    update: (model) => {
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
    dispose: () => {
      summary.dispose();
      bar.remove();
    },
  };
}
