import type { MatchOutcome, SimEvent } from '@open-northland/sim';
import type { UiString } from '../content/gui-gfx.js';
import { messages } from '../i18n/index.js';
import { confirmDialog } from './confirm-dialog.js';
import { matchResultActions, matchResultState } from './match-result-state.js';

/** The decoded original strings the verdict prefers over the catalog fallbacks (`miscwindow`). */
const WON_TITLE_STRING_ID = 81;
const LOST_TITLE_STRING_ID = 82;
/** Above the system menu's backdrop (z 2000) and below the confirm dialog (z 3000). */
const VERDICT_Z_INDEX = '2500';

const PANEL_STYLE = [
  'min-width:280px',
  'max-width:min(460px,90vw)',
  'display:flex',
  'flex-direction:column',
  'gap:12px',
  'padding:22px 24px',
  'background:rgba(20,16,12,0.96)',
  'color:#e8dcc0',
  'font:15px/1.4 ui-serif,Georgia,serif',
  'border:1px solid rgba(138,116,74,0.7)',
  'border-radius:8px',
  'box-shadow:0 8px 32px rgba(0,0,0,0.5)',
].join(';');

const BUTTON_STYLE = [
  'padding:8px 14px',
  'background:rgba(74,63,40,0.9)',
  'color:#e8dcc0',
  'font:inherit',
  'border:1px solid rgba(138,116,74,0.7)',
  'border-radius:5px',
  'cursor:pointer',
].join(';');

export interface MatchResultDeps {
  readonly localPlayer: number;
  readonly sharedClock?: boolean;
  readonly uiString: UiString;
  /** Hold the sim while the verdict is up; released when the player chooses to go on. */
  readonly pause: () => void;
  readonly resume: () => void;
  readonly onQuit: () => void;
}

export interface MatchResultOverlay {
  /** Feed the frame's sim events; the first verdict for the local seat raises the panel. */
  onEvents(events: readonly SimEvent[]): void;
  /** Raise the panel for a verdict already standing, as a restored save of a decided match carries. */
  announce(outcome: MatchOutcome): void;
  finish(outcome: MatchOutcome): void;
  dispose(): void;
}

/** The local seat's verdict for `events`, or null when none of them decides it. */
export function localVerdict(events: readonly SimEvent[], localPlayer: number): MatchOutcome | null {
  for (const event of events) {
    if (event.kind === 'playerWon' && event.player === localPlayer) return 'victory';
    if (event.kind === 'playerDefeated' && event.player === localPlayer) return 'defeat';
  }
  return null;
}

/** Local outcomes can be dismissed; a confirmed multiplayer finish replaces them permanently. */
export function createMatchResultOverlay(deps: MatchResultDeps): MatchResultOverlay {
  const state = matchResultState();
  let backdrop: HTMLDivElement | null = null;

  const show = (verdict: MatchOutcome, terminal = false): void => {
    hide();
    const actions = matchResultActions(deps.sharedClock === true, terminal);
    const copy = messages().hud;
    const won = verdict === 'victory';
    if (actions.pause) deps.pause();

    backdrop = document.createElement('div');
    Object.assign(backdrop.style, {
      position: 'fixed',
      inset: '0',
      display: 'grid',
      placeItems: 'center',
      background: 'rgba(0,0,0,0.45)',
      zIndex: VERDICT_Z_INDEX,
    });
    const panel = document.createElement('div');
    panel.style.cssText = PANEL_STYLE;
    panel.setAttribute('role', 'alertdialog');
    panel.setAttribute('aria-modal', 'true');

    const title = document.createElement('h2');
    title.textContent =
      verdict === 'undecided'
        ? copy.matchFinishedTitle
        : won
          ? deps.uiString('miscwindow', WON_TITLE_STRING_ID, copy.matchWonTitle)
          : deps.uiString('miscwindow', LOST_TITLE_STRING_ID, copy.matchLostTitle);
    Object.assign(title.style, { margin: '0', font: '20px/1.2 ui-serif,Georgia,serif' });
    panel.setAttribute('aria-label', title.textContent);

    const detail = document.createElement('p');
    detail.style.cssText = 'margin:0';
    detail.textContent = terminal
      ? copy.matchFinishedDetail
      : won
        ? copy.matchWonDetail
        : copy.matchLostDetail;

    const button = (label: string, onClick: () => void): HTMLButtonElement => {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = label;
      el.style.cssText = BUTTON_STYLE;
      el.addEventListener('click', onClick);
      return el;
    };
    const stay = button(won ? copy.matchContinue : copy.matchWatch, () => {
      hide();
      if (actions.pause) deps.resume();
    });
    // Quitting throws away everything since the last save, so it asks like the system menu does.
    const quit = button(copy.returnToMenu, () => {
      if (!actions.confirmQuit) {
        hide();
        deps.onQuit();
        return;
      }
      void confirmDialog({
        message: copy.quitConfirm,
        confirmLabel: copy.quitConfirmYes,
        cancelLabel: copy.quitConfirmNo,
      }).then((confirmed) => {
        if (!confirmed) return;
        hide();
        deps.onQuit();
      });
    });
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', gap: '10px', justifyContent: 'flex-end' });
    if (actions.stay) row.append(stay);
    row.append(quit);
    panel.append(title, detail, row);
    backdrop.append(panel);
    document.body.append(backdrop);
    (actions.stay ? stay : quit).focus();
  };

  const hide = (): void => {
    backdrop?.remove();
    backdrop = null;
  };

  const announce = (outcome: MatchOutcome): void => {
    if (deps.sharedClock && outcome === 'victory') return;
    if (!state.announce(outcome)) return;
    show(outcome);
  };

  return {
    onEvents(events): void {
      const verdict = localVerdict(events, deps.localPlayer);
      if (verdict !== null) announce(verdict);
    },
    announce,
    finish(outcome): void {
      if (state.finish()) show(outcome, true);
    },
    dispose: hide,
  };
}
