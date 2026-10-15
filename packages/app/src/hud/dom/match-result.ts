import type { MatchOutcome, MatchRank, SimEvent } from '@open-northland/sim';
import { formatMessage, messages } from '../../i18n/index.js';
import { matchResultActions, matchResultState } from '../../view/match-result-state.js';
import { GLYPH } from './icons.js';
import { createHudPlane, type HudPlane } from './root.js';
import { createSystemConfirm } from './system-confirm.js';
import { createHudWindow } from './window.js';

export interface MatchResultDeps {
  readonly localPlayer: number;
  readonly sharedClock?: boolean;
  /** False where the map's script ends a won mission itself, so no panel pauses it before its unlocks. */
  readonly announcesVictory?: boolean;
  /** A goal table's verdicts in the order they landed, read when the window opens; empty shows no list. */
  readonly ranking?: () => readonly MatchRank[];
  /** The roster's authored seat name; absent, the list numbers the seat. */
  readonly seatNameOf?: ((player: number) => string | undefined) | undefined;
  readonly hud: Pick<HudPlane, 'element' | 'currentScale'>;
  readonly pause: () => void;
  readonly resume: () => void;
  readonly onOpen: () => void;
  readonly setCameraSuspended: (suspended: boolean) => void;
  readonly onQuit: () => void;
  readonly onContinue: () => void;
}

export interface MatchResultOverlay {
  onEvents(events: readonly SimEvent[]): void;
  announce(outcome: MatchOutcome): void;
  finish(outcome: MatchOutcome): void;
  isOpen(): boolean;
  /** A lost link owns the page until it returns; retain the result without accepting input. */
  setSuspended(suspended: boolean): void;
  dispose(): void;
}

/** The result is permanent; dismissing its window returns to local play or a shared spectator view. */
/** Whether a script's `Exit` is ignored because the player plays on past a verdict: always on a shared
 *  clock, and after any verdict except a victory the map's script ends itself. */
export function keepsPlayingAfterResult(
  outcome: MatchOutcome,
  sharedClock: boolean,
  scriptEndsVictory: boolean,
): boolean {
  if (sharedClock) return true;
  if (outcome === 'victory') return !scriptEndsVictory;
  return outcome === 'defeat';
}

export function createMatchResultOverlay(deps: MatchResultDeps): MatchResultOverlay {
  const state = matchResultState();
  let close: (() => void) | null = null;
  let suspended = false;
  let current: { verdict: MatchOutcome; terminal: boolean } | null = null;
  const hide = (): void => {
    close?.();
    current = null;
  };

  const show = (verdict: MatchOutcome, terminal = false): void => {
    hide();
    current = { verdict, terminal };
    if (suspended) return;
    deps.onOpen();
    const scope = new AbortController();
    const actions = matchResultActions(deps.sharedClock === true, terminal);
    const copy = messages().hud;
    const won = verdict === 'victory';
    const watching = deps.sharedClock === true;
    const title = won
      ? copy.matchWonTitle
      : verdict === 'defeat'
        ? copy.matchLostTitle
        : copy.matchFinishedTitle;
    const previousFocus = document.activeElement;
    if (actions.pause) deps.pause();
    deps.setCameraSuspended(true);

    const backdrop = document.createElement('div');
    backdrop.className = 'on-system-backdrop on-result-backdrop';
    const plane = createHudPlane(deps.hud.currentScale());
    plane.element.classList.add('on-system-plane');
    backdrop.append(plane.element);
    const frame = createHudWindow(plane.element, {
      title,
      closeLabel: copy.matchContinue,
      width: 480,
      headless: true,
    });
    frame.element.querySelector('.on-window__close')?.remove();
    frame.element.classList.add('on-system-dialog', 'on-result');
    frame.element.dataset.result = verdict;
    frame.element.setAttribute('role', 'alertdialog');
    frame.element.setAttribute('aria-modal', 'true');
    const crest = document.createElement('div');
    crest.className = 'on-result__crest';
    crest.setAttribute('aria-hidden', 'true');
    crest.innerHTML = won ? GLYPH.banner : verdict === 'defeat' ? GLYPH.swords : GLYPH.shield;
    const line = (tag: string, className: string, text: string): HTMLElement => {
      const node = document.createElement(tag);
      node.className = className;
      node.textContent = text;
      return node;
    };
    const rule = line('div', 'on-result__rule', '');
    rule.setAttribute('aria-hidden', 'true');
    frame.body.append(
      crest,
      line('p', 'on-result__kicker', copy.matchKicker),
      line('h2', 'on-result__title', title),
      rule,
    );
    if (terminal) frame.body.append(line('p', 'on-result__detail', copy.matchFinishedDetail));
    const ranking = deps.ranking?.() ?? [];
    if (ranking.length > 0) {
      const list = document.createElement('ol');
      list.className = 'on-result__ranking';
      list.setAttribute('aria-label', copy.matchRankingTitle);
      ranking.forEach((rank, index) => {
        const row = document.createElement('li');
        row.className = 'on-result__rank';
        if (rank.player === deps.localPlayer) row.dataset.local = 'true';
        row.dataset.outcome = rank.outcome;
        const name =
          deps.seatNameOf?.(rank.player) ?? formatMessage(copy.matchRankSeat, { n: rank.player + 1 });
        row.append(
          line('span', 'on-result__rank-no', `${index + 1}.`),
          line('span', 'on-result__rank-name', name),
          line(
            'span',
            'on-result__rank-verdict',
            rank.outcome === 'victory' ? copy.matchRankWon : copy.matchRankLost,
          ),
        );
        list.append(row);
      });
      frame.body.append(list);
    }
    if (watching) frame.body.append(line('p', 'on-result__hint', copy.matchWatchHint));
    const confirm = createSystemConfirm(plane.element);
    const button = (label: string, glyph: string, click: () => void): HTMLButtonElement => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'on-button';
      el.innerHTML = glyph;
      el.append(line('span', '', label));
      el.addEventListener('click', click, { signal: scope.signal });
      return el;
    };
    const stay = (): void => {
      deps.onContinue();
      hide();
    };
    const resume = button(watching ? copy.matchWatch : copy.matchContinue, GLYPH.next, stay);
    resume.classList.add('on-result__continue');
    const quit = button(copy.returnToMenu, GLYPH.exit, () => {
      if (!actions.confirmQuit) {
        hide();
        deps.onQuit();
        return;
      }
      void confirm
        .open({
          title: copy.returnToMenu,
          message: copy.quitConfirm,
          confirm: copy.quitConfirmYes,
          cancel: copy.systemMenuDetails.cancel,
        })
        .then((confirmed) => {
          if (!confirmed || scope.signal.aborted) return;
          hide();
          deps.onQuit();
        });
    });
    const row = line('div', 'on-result__actions', '');
    row.append(resume, quit);
    frame.body.append(row);
    const inert = new Map<HTMLElement, boolean>();
    for (const child of document.body.children) {
      if (child instanceof HTMLElement) {
        inert.set(child, child.inert);
        child.inert = true;
      }
    }
    document.body.append(backdrop);
    const resize = new ResizeObserver(() => void plane.setUiScale(deps.hud.currentScale()));
    resize.observe(deps.hud.element);
    close = () => {
      close = null;
      scope.abort();
      confirm.cancel();
      resize.disconnect();
      backdrop.remove();
      for (const [element, prior] of inert) element.inert = prior;
      deps.setCameraSuspended(false);
      if (actions.pause) deps.resume();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
    document.addEventListener(
      'keydown',
      (event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          if (confirm.isOpen()) confirm.cancel();
          else stay();
        } else if (event.key === 'Tab') {
          const panel =
            plane.element.querySelector('.on-system-confirm [role="alertdialog"]') ?? frame.element;
          const buttons = [...panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
          const first = buttons[0];
          const last = buttons.at(-1);
          if (
            event.shiftKey &&
            (document.activeElement === first || !panel.contains(document.activeElement))
          ) {
            event.preventDefault();
            last?.focus();
          } else if (
            !event.shiftKey &&
            (document.activeElement === last || !panel.contains(document.activeElement))
          ) {
            event.preventDefault();
            first?.focus();
          }
        }
      },
      { signal: scope.signal },
    );
    frame.open();
    resume.focus();
  };

  const announce = (outcome: MatchOutcome, scripted = false): void => {
    if (deps.sharedClock && outcome === 'victory' && !scripted) return;
    if (deps.announcesVictory === false && outcome === 'victory') return;
    if (state.announce(outcome)) show(outcome);
  };
  return {
    onEvents(events): void {
      for (const event of events) {
        if (event.kind !== 'playerWon' && event.kind !== 'playerDefeated') continue;
        if (event.player !== deps.localPlayer || event.notificationAlreadySent === true) continue;
        const won = event.kind === 'playerWon';
        if (deps.sharedClock && won && event.scripted !== true) continue;
        announce(won ? 'victory' : 'defeat', event.scripted === true);
        return;
      }
    },
    announce,
    finish(outcome): void {
      if (state.finish()) show(outcome, true);
    },
    isOpen: () => close !== null,
    setSuspended(next): void {
      if (suspended === next) return;
      suspended = next;
      if (next) close?.();
      else if (current !== null) show(current.verdict, current.terminal);
    },
    dispose: hide,
  };
}
