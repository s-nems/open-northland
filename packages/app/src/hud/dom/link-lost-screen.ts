import { formatMessage, messages } from '../../i18n/index.js';
import { KICK_COUNTDOWN_MS, type NetLinkLoss } from '../network/model.js';
import { createHudPlane, type HudPlane } from './root.js';
import { createHudWindow } from './window.js';

const MS_PER_SECOND = 1000;

export interface LinkLostScreenDeps {
  readonly hud: Pick<HudPlane, 'element' | 'currentScale'>;
  readonly setCameraSuspended: (suspended: boolean) => void;
  /** The one thing the screen lets the player do: leave the game. */
  readonly onLeave: () => void;
  /** Wall milliseconds on the clock the loss's `waitedSinceMs` is on; default `performance.now`. */
  readonly now?: () => number;
}

export interface LinkLostScreen {
  /** Once a frame: up over everything while the link is lost, counting down the room's wait; gone
   *  once the relay is heard again. */
  refresh(loss: NetLinkLoss | null): void;
  /** True while the screen owns the page: no click reaches the game and no key is the shell's. */
  isOpen(): boolean;
  dispose(): void;
}

/** Whole seconds until the others may vote this client out, 0 once they may. */
export function voteOpensInSeconds(loss: Extract<NetLinkLoss, { kind: 'dropped' }>, nowMs: number): number {
  return Math.ceil(Math.max(0, KICK_COUNTDOWN_MS - (nowMs - loss.waitedSinceMs)) / MS_PER_SECOND);
}

/** What a relayed game shows the player whose own link is lost: the pause wash, one window saying so
 *  with the same countdown the other players see beside this client's name, and a way out. Everything
 *  under it is inert, so no order is clicked or keyed into a game that cannot carry it. */
export function createLinkLostScreen(deps: LinkLostScreenDeps): LinkLostScreen {
  const scope = new AbortController();
  const now = deps.now ?? ((): number => performance.now());
  const copy = messages().hud.linkLost;
  const backdrop = document.createElement('div');
  backdrop.className = 'on-system-backdrop';
  backdrop.hidden = true;
  const scale = deps.hud.currentScale;
  const plane = createHudPlane(scale());
  plane.element.classList.add('on-system-plane');
  backdrop.append(plane.element);
  const frame = createHudWindow(plane.element, {
    title: copy.title,
    closeLabel: copy.leave,
    width: 360,
    compact: true,
  });
  frame.element.querySelector('.on-window__close')?.remove();
  frame.element.classList.add('on-system-dialog', 'on-link-lost');
  frame.element.setAttribute('role', 'alertdialog');
  frame.element.setAttribute('aria-modal', 'true');
  const message = document.createElement('p');
  message.className = 'on-link-lost__message';
  const countdown = document.createElement('p');
  countdown.className = 'on-link-lost__countdown';
  // The ticking number stays silent to a screen reader; the hint says once when the vote opens.
  const hint = document.createElement('p');
  hint.className = 'on-link-lost__hint';
  hint.setAttribute('aria-live', 'polite');
  const actions = document.createElement('div');
  actions.className = 'on-link-lost__actions';
  const leave = document.createElement('button');
  leave.type = 'button';
  leave.className = 'on-button';
  leave.textContent = copy.leave;
  leave.addEventListener('click', () => {
    if (!scope.signal.aborted) deps.onLeave();
  });
  actions.append(leave);
  frame.body.append(message, countdown, hint, actions);
  document.body.append(backdrop);

  const inert = new Map<HTMLElement, boolean>();
  let previousFocus: Element | null = null;
  let shown: { readonly kind: NetLinkLoss['kind']; readonly seconds: number; readonly text: string } | null =
    null;

  // A click beside the window lands nowhere; the button keeps the focus so Enter still leaves.
  backdrop.addEventListener('click', () => leave.focus(), { signal: scope.signal });
  // No key under the screen is the game's: the shell's hotkeys, the orders and the camera all listen
  // on the document or the window below this listener.
  document.addEventListener(
    'keydown',
    (event) => {
      if (backdrop.hidden) return;
      event.stopPropagation();
      if (event.key === 'Tab') {
        event.preventDefault();
        leave.focus();
      }
    },
    { signal: scope.signal },
  );
  const resize = new ResizeObserver(() => void plane.setUiScale(scale()));
  resize.observe(deps.hud.element);

  const show = (): void => {
    if (!backdrop.hidden) return;
    // A native modal dialog (a profession or school pick) holds the top layer above this screen: it is
    // cancelled as its own Escape would cancel it, before the page is taken over.
    for (const dialog of document.querySelectorAll('dialog[open]'))
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    previousFocus = document.activeElement;
    for (const child of document.body.children) {
      if (child instanceof HTMLElement && child !== backdrop) {
        inert.set(child, child.inert);
        child.inert = true;
      }
    }
    deps.setCameraSuspended(true);
    void plane.setUiScale(scale());
    backdrop.hidden = false;
    frame.open();
    leave.focus();
  };
  const hide = (): void => {
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    frame.close();
    shown = null;
    deps.setCameraSuspended(false);
    for (const [element, prior] of inert) element.inert = prior;
    inert.clear();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  };
  const write = (loss: NetLinkLoss): void => {
    const seconds = loss.kind === 'dropped' ? voteOpensInSeconds(loss, now()) : 0;
    const text = loss.kind === 'closed' ? loss.reason : '';
    if (shown !== null && shown.kind === loss.kind && shown.seconds === seconds && shown.text === text)
      return;
    shown = { kind: loss.kind, seconds, text };
    if (loss.kind === 'closed') {
      message.textContent = formatMessage(copy.closed, { reason: loss.reason });
      countdown.hidden = true;
      hint.textContent = copy.closedHint;
      return;
    }
    message.textContent = copy.dropped;
    countdown.hidden = false;
    countdown.textContent = formatMessage(copy.seconds, { seconds });
    hint.textContent = seconds > 0 ? copy.voteOpensIn : copy.voteOpen;
  };

  return {
    refresh(loss): void {
      if (loss === null) {
        hide();
        return;
      }
      show();
      write(loss);
    },
    isOpen: () => !backdrop.hidden,
    dispose(): void {
      hide();
      scope.abort();
      resize.disconnect();
      backdrop.remove();
    },
  };
}
