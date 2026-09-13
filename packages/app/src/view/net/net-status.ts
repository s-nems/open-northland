import type { RoomView, WaitedMember, WaitReason } from '@open-northland/net-protocol';
import { formatMessage, messages } from '../../i18n/index.js';
import { el, PANEL_STYLE } from '../overlay.js';
import type { NetReadout } from '../runtime/net-readout.js';

export type MemberStatus = WaitReason | 'ok';

export interface MemberRow {
  readonly nick: string;
  readonly seat: number | null;
  readonly status: MemberStatus;
  readonly self: boolean;
}

/** Every member's standing as the room and the wait list say it: the wait's reason wins over the
 *  connection flag, and a member nobody waits for is fine or simply gone. */
export function memberRows(
  room: RoomView | null,
  waiting: readonly WaitedMember[],
  selfNick: string,
): readonly MemberRow[] {
  if (room === null) return [];
  const reasons = new Map(waiting.map((member) => [member.nick, member.reason]));
  return room.members.map((member) => ({
    nick: member.nick,
    seat: member.seat,
    status: reasons.get(member.nick) ?? (member.connected ? 'ok' : 'gone'),
    self: member.nick === selfNick,
  }));
}

export interface NetStatusPanel {
  update(rows: readonly MemberRow[], readout: NetReadout): void;
  dispose(): void;
}

const STATUS_PANEL_STYLE = `${PANEL_STYLE};width:auto;min-width:200px;max-width:calc(100vw - 80px);box-sizing:border-box;padding:8px 12px;font-size:12px;pointer-events:none`;
const ROW_STYLE = 'display:flex;justify-content:space-between;gap:16px';

/** The top-right player list with each member's status and this client's own connection figures. */
export function mountNetStatusPanel(): NetStatusPanel {
  const panel = el('div', STATUS_PANEL_STYLE);
  panel.setAttribute('role', 'status');
  const position = (): void => {
    panel.style.top = window.innerWidth < 1200 ? '96px' : '12px';
  };
  position();
  window.addEventListener('resize', position);
  const title = el('div', 'font-weight:700;margin-bottom:4px', messages().net.players);
  const list = el('div', '');
  const link = el('div', 'margin-top:6px;opacity:0.8');
  panel.append(title, list, link);
  document.body.append(panel);
  return {
    update(rows, readout): void {
      const copy = messages().net;
      list.replaceChildren(
        ...rows.map((row) => {
          const line = el('div', ROW_STYLE);
          const name = el('span', row.self ? 'font-weight:700' : '', row.nick);
          const status = el(
            'span',
            row.status === 'ok' ? 'opacity:0.7' : 'color:#f0c070',
            copy.status[row.status],
          );
          line.append(name, status);
          return line;
        }),
      );
      const trip = readout.roundTripMs === null ? '-' : readout.roundTripMs.toFixed(0);
      const delay =
        readout.delayTicks === null || readout.delayMs === null
          ? null
          : formatMessage(copy.inputDelay, { ticks: readout.delayTicks, ms: readout.delayMs.toFixed(0) });
      link.textContent = readout.connected
        ? [formatMessage(copy.roundTrip, { ms: trip }), ...(delay === null ? [] : [delay])].join(' · ')
        : copy.reconnecting;
    },
    dispose: () => {
      window.removeEventListener('resize', position);
      panel.remove();
    },
  };
}
