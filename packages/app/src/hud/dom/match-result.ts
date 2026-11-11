import type { MatchOutcome, MatchRank, SimEvent } from '@open-northland/sim';
import { isReportDialog } from '../../diag/report/dialog.js';
import { formatMessage, messages } from '../../i18n/index.js';
import { GLYPH } from './icons.js';
import { createHudPlane, type HudPlane } from './root.js';
import { createSystemConfirm, type SystemConfirmCopy } from './system/confirm.js';
import { createHudWindow } from './window.js';

export interface MatchResultDeps {
  readonly localPlayer: number;
  readonly sharedClock?: boolean;
  /** Defer victory until `finish`, after the script's unlocks have persisted. */
  readonly scriptedEnding?: boolean;
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
  /** Opens the load page from a defeat; `back` shows the result again when it closes without loading. */
  readonly onLoad?: (back: () => void) => void;
  /** Starts over from a defeat, as a new match. */
  readonly playAgain?: ReplayOffer;
}

/** A fresh start, as a new match: of the `map` being played, or from a sub-mission of the whole
 *  `mission`, back on its main map. */
export interface ReplayOffer {
  readonly scope: 'map' | 'mission';
  readonly start: () => void;
}

/** The question that stands before `offer` starts. */
export function replayQuestion(offer: ReplayOffer): string {
  const copy = messages().hud;
  return offer.scope === 'mission' ? copy.playAgainMissionConfirm : copy.playAgainConfirm;
}

/** What may hold the result window back: a lost link owns the page until it returns, and the
 *  mission book is read first, so a closing briefing comes before the verdict. */
export type MatchResultSuspender = 'linkLost' | 'missionBook';

export interface MatchResultOverlay {
  onEvents(events: readonly SimEvent[]): void;
  announce(outcome: MatchOutcome): void;
  finish(outcome: MatchOutcome): void;
  isOpen(): boolean;
  /** Retain the result without showing it while any suspender holds it. */
  setSuspended(by: MatchResultSuspender, suspended: boolean): void;
  dispose(): void;
}

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

function matchResultState() {
  let shown = false;
  let finished = false;
  return {
    announce(outcome: MatchOutcome): boolean {
      if (shown || finished || outcome === 'undecided') return false;
      shown = true;
      return true;
    },
    finish(): boolean {
      if (finished) return false;
      finished = true;
      return true;
    },
  };
}

function matchResultActions(shared: boolean, terminal: boolean) {
  return { pause: !shared, confirmQuit: !terminal };
}

/** The result is permanent; dismissing its window returns to local play or a shared spectator view. */
export function createMatchResultOverlay(deps: MatchResultDeps): MatchResultOverlay {
  const state = matchResultState();
  let close: (() => void) | null = null;
  const suspenders = new Set<MatchResultSuspender>();
  let current: { verdict: MatchOutcome; terminal: boolean } | null = null;
  // The result set aside while the load page is open; cleared when anything else replaces it.
  let awayToLoad: { verdict: MatchOutcome; terminal: boolean } | null = null;
  const hide = (): void => {
    close?.();
    current = null;
    awayToLoad = null;
  };

  const show = (verdict: MatchOutcome, terminal = false): void => {
    hide();
    current = { verdict, terminal };
    if (suspenders.size > 0) return;
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
    const dismiss = (): void => {
      deps.onContinue();
      hide();
    };
    const resume = button(watching ? copy.matchWatch : copy.matchContinue, GLYPH.next, dismiss);
    resume.classList.add('on-result__continue');
    const leave = (ask: Omit<SystemConfirmCopy, 'cancel'>, go: () => void): void => {
      if (!actions.confirmQuit) {
        hide();
        go();
        return;
      }
      void confirm.open({ ...ask, cancel: copy.systemMenuDetails.cancel }).then((confirmed) => {
        if (!confirmed || scope.signal.aborted) return;
        hide();
        go();
      });
    };
    const quit = button(copy.returnToMenu, GLYPH.exit, () =>
      leave(
        { title: copy.returnToMenu, message: copy.quitConfirm, confirm: copy.quitConfirmYes },
        deps.onQuit,
      ),
    );
    const row = line('div', 'on-result__actions', '');
    row.append(resume);
    const playAgain = deps.playAgain;
    if (playAgain !== undefined && verdict === 'defeat') {
      row.append(
        button(copy.playAgain, GLYPH.replay, () =>
          leave(
            { title: copy.playAgain, message: replayQuestion(playAgain), confirm: copy.playAgain },
            playAgain.start,
          ),
        ),
      );
    }
    const onLoad = deps.onLoad;
    if (onLoad !== undefined && verdict === 'defeat') {
      row.append(
        button(copy.loadGame, GLYPH.book, () => {
          const away = { verdict, terminal };
          hide();
          awayToLoad = away;
          onLoad(() => {
            if (awayToLoad !== away) return;
            awayToLoad = null;
            show(away.verdict, away.terminal);
          });
        }),
      );
    }
    row.append(quit);
    frame.body.append(row);
    const inert = new Map<HTMLElement, boolean>();
    for (const child of document.body.children) {
      if (child instanceof HTMLElement && !isReportDialog(child)) {
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
          else dismiss();
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
    if (deps.scriptedEnding === true && outcome === 'victory') return;
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
    setSuspended(by, next): void {
      if (suspenders.has(by) === next) return;
      if (next) suspenders.add(by);
      else suspenders.delete(by);
      if (next) close?.();
      else if (suspenders.size === 0 && current !== null) show(current.verdict, current.terminal);
    },
    dispose: hide,
  };
}
