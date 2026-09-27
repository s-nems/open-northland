import type { GovernedClock, ServerMessage, WaitedMember } from '@open-northland/net-protocol';
import { currentLocale, formatMessage, messages } from '../../i18n/index.js';
import { BUTTON_STYLE, el } from '../overlay.js';
import { formatSpeed } from '../perf-overlay.js';

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

export interface WaitingText {
  readonly title: string;
  /** One line per row, in the rows' order: the member and why the room waits for them. */
  readonly lines: readonly string[];
  /** Said under the list while this client's own member is the one slowing the game. */
  readonly footer: string | null;
}

/** What the panel says over `rows`: a room only slowed down reads differently from one held. */
export function waitingText(
  rows: readonly WaitedRow[],
  governed: GovernedClock | null,
  ownNick: string,
): WaitingText {
  const copy = messages().net;
  const slowing = rows.filter((row) => row.reason === 'slow');
  return {
    title: slowing.length === rows.length ? copy.slowedTitle : copy.waitingTitle,
    lines: rows.map((row) => `${row.nick} · ${reasonText(row, governed)}`),
    footer: slowing.some((row) => row.nick === ownNick) ? copy.othersWaitForYou : null,
  };
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
  /** The member the relay slows the clock for and the speed it runs at; null when none. */
  governed(state: GovernedClock | null): void;
  dispose(): void;
}

/** The panel over a held game: who the room waits for, for how long, and the vote to kick them. */
export function createWaitingOverlay(deps: WaitingOverlayDeps): WaitingOverlay {
  const now = deps.now ?? ((): number => performance.now());
  let waited: readonly WaitedMember[] = [];
  let receivedAt = 0;
  let noticeText: string | null = null;
  let governedClock: GovernedClock | null = null;
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
      governedClock,
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
      const text = waitingText(rows, governedClock, deps.ownNick());
      children.push(el('div', 'font-weight:700', text.title));
      for (const [index, row] of rows.entries()) {
        const line = el('div', 'display:flex;align-items:center;gap:10px;justify-content:space-between');
        const seat = deps.seatOf(row.nick);
        const tally = seat === null ? undefined : tallies.get(seat);
        line.append(el('span', '', text.lines[index] ?? row.nick));
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
      if (text.footer !== null) children.push(el('div', 'opacity:0.9', text.footer));
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
    governed(state): void {
      governedClock = state;
      render();
    },
    dispose(): void {
      waited = [];
      noticeText = null;
      render();
    },
  };
}

/** Why the room waits for a row's member; the member the clock is slowed for also names the speed. */
function reasonText(row: WaitedRow, governed: GovernedClock | null): string {
  const copy = messages().net;
  if (row.reason === 'slow' && governed !== null && governed.nick === row.nick) {
    return formatMessage(copy.slowingTo, { speed: formatSpeed(governed.speed) });
  }
  return copy.reasons[row.reason];
}
