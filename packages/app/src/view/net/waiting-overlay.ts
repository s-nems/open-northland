import type { ServerMessage, WaitedMember } from '@open-northland/net-protocol';
import { currentLocale, formatMessage, messages } from '../../i18n/index.js';
import { BUTTON_STYLE, el } from '../overlay.js';

/** Above the HUD and the perf readout, below the system menu (z 2000), so the menu still opens over it. */
const WAITING_Z_INDEX = '1500';
/** The countdown is redrawn on this cadence; finer would only redraw the same second. */
const REDRAW_MS = 250;

const PANEL_STYLE = [
  'position:fixed',
  'top:56px',
  'left:50%',
  'transform:translateX(-50%)',
  'min-width:280px',
  'max-width:min(520px,90vw)',
  'display:flex',
  'flex-direction:column',
  'gap:8px',
  'padding:14px 18px',
  'background:rgba(20,16,12,0.94)',
  'color:#e8dcc0',
  'font:14px/1.4 ui-serif,Georgia,serif',
  'border:1px solid rgba(138,116,74,0.7)',
  'border-radius:8px',
  'box-shadow:0 8px 32px rgba(0,0,0,0.5)',
  `z-index:${WAITING_Z_INDEX}`,
].join(';');

export type KickVote = Extract<ServerMessage, { kind: 'kickVote' }>;

export interface WaitedRow {
  readonly nick: string;
  readonly reason: WaitedMember['reason'];
  /** Whole seconds until a kick vote may open; 0 once it may. */
  readonly voteInSeconds: number;
}

/** The rows a wait list shows at `now`, with each countdown carried on from the moment it arrived. */
export function waitedRows(
  waited: readonly WaitedMember[],
  receivedAt: number,
  now: number,
): readonly WaitedRow[] {
  const elapsed = Math.max(0, now - receivedAt);
  return waited.map((member) => ({
    nick: member.nick,
    reason: member.reason,
    voteInSeconds: Math.ceil(Math.max(0, member.voteAfterMs - elapsed) / 1000),
  }));
}

export interface WaitingOverlayDeps {
  /** The seat a nick holds, for the kick vote; null for a member without one. */
  readonly seatOf: (nick: string) => number | null;
  /** This client's own nick; the relay counts no vote against yourself, so none is offered. */
  readonly ownNick: () => string;
  readonly onKick: (player: number) => void;
  readonly now?: () => number;
}

export interface WaitingOverlay {
  /** A `waiting` notice; an empty list ends the wait. */
  waiting(waited: readonly WaitedMember[]): void;
  tally(vote: KickVote): void;
  /** A line above the list about this client's own link or world; null clears it. */
  notice(text: string | null): void;
  dispose(): void;
}

/** The panel over a held game: who the room waits for, for how long, and the vote to kick them. */
export function createWaitingOverlay(deps: WaitingOverlayDeps): WaitingOverlay {
  const now = deps.now ?? ((): number => performance.now());
  let waited: readonly WaitedMember[] = [];
  let receivedAt = 0;
  let noticeText: string | null = null;
  const tallies = new Map<number, KickVote>();
  let panel: HTMLDivElement | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let rendered = '';

  const render = (): void => {
    const copy = messages().net;
    const rows = waitedRows(waited, receivedAt, now());
    if (rows.length === 0 && noticeText === null) {
      panel?.remove();
      panel = null;
      rendered = '';
      if (timer !== null) clearInterval(timer);
      timer = null;
      return;
    }
    if (panel === null) {
      panel = el('div', PANEL_STYLE);
      panel.setAttribute('role', 'status');
      document.body.append(panel);
      timer = setInterval(render, REDRAW_MS);
    }
    const signature = JSON.stringify([
      currentLocale(),
      noticeText,
      rows,
      [...tallies],
      rows.map((row) => deps.seatOf(row.nick)),
      deps.ownNick(),
    ]);
    if (signature === rendered) return;
    rendered = signature;
    const focused = document.activeElement;
    const focusedSeat =
      focused instanceof HTMLButtonElement && panel.contains(focused) ? focused.dataset.seat : undefined;
    const children: HTMLElement[] = [];
    if (noticeText !== null) children.push(el('div', 'opacity:0.9', noticeText));
    if (rows.length > 0) {
      children.push(el('div', 'font-weight:700', copy.waitingTitle));
      for (const row of rows) {
        const line = el('div', 'display:flex;align-items:center;gap:10px;justify-content:space-between');
        const seat = deps.seatOf(row.nick);
        const tally = seat === null ? undefined : tallies.get(seat);
        line.append(el('span', '', `${row.nick} · ${copy.reasons[row.reason]}`));
        if (row.voteInSeconds > 0) {
          line.append(
            el('span', 'opacity:0.7', formatMessage(copy.kickCountdown, { seconds: row.voteInSeconds })),
          );
        } else if (seat !== null && row.nick !== deps.ownNick()) {
          const label =
            tally === undefined
              ? copy.voteKick
              : `${copy.voteKick} (${formatMessage(copy.voteTally, { yes: tally.yes.length, needed: tally.needed })})`;
          const button = el('button', BUTTON_STYLE, label);
          button.type = 'button';
          button.dataset.seat = String(seat);
          button.addEventListener('click', () => deps.onKick(seat));
          line.append(button);
        }
        children.push(line);
      }
    }
    panel.replaceChildren(...children);
    if (focusedSeat !== undefined) {
      for (const button of panel.querySelectorAll('button')) {
        if (button.dataset.seat === focusedSeat) button.focus({ preventScroll: true });
      }
    }
  };

  return {
    waiting(list): void {
      waited = list;
      receivedAt = now();
      const stillWaited = new Set(list.map((member) => deps.seatOf(member.nick)));
      for (const seat of tallies.keys()) if (!stillWaited.has(seat)) tallies.delete(seat);
      render();
    },
    tally(vote): void {
      tallies.set(vote.player, vote);
      render();
    },
    notice(text): void {
      noticeText = text;
      render();
    },
    dispose(): void {
      waited = [];
      noticeText = null;
      render();
    },
  };
}
