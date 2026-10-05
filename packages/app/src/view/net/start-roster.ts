import { MAX_LOADING_PROGRESS, type RoomView, type WaitedMember } from '@open-northland/net-protocol';
import { playerSwatchHex } from '../../catalog/roster.js';
import { messages } from '../../i18n/index.js';

export type StartRosterState = 'loading' | 'ready' | 'away';

export interface StartRosterRow {
  readonly nick: string;
  /** CSS colour of the player's seat. */
  readonly color: string;
  readonly self: boolean;
  readonly state: StartRosterState;
  /** Boot progress in whole percent while loading, once known. */
  readonly progress: number | null;
}

export interface StartRosterInputs {
  readonly room: RoomView | null;
  readonly waitingFor: readonly WaitedMember[];
  /** False until the relay's first word on who it waits for: until then nobody reads as ready. */
  readonly heardWaiting: boolean;
  readonly ownNick: string;
  /** This client's own boot progress, ahead of what the room view last carried. */
  readonly ownProgress: number | null;
}

/** One row per seated member, in seat order. */
export function startRosterRows(inputs: StartRosterInputs): readonly StartRosterRow[] {
  const { room } = inputs;
  if (room === null) return [];
  const reasons = new Map(inputs.waitingFor.map((member) => [member.nick, member.reason]));
  const seated = room.members
    .flatMap((member) => (member.seat === null ? [] : [{ member, seat: member.seat }]))
    .sort((a, b) => a.seat - b.seat);
  return seated.map(({ member, seat }): StartRosterRow => {
    const self = member.nick === inputs.ownNick;
    const reason = reasons.get(member.nick);
    const state: StartRosterState =
      reason === 'gone' || reason === 'silent'
        ? 'away'
        : reason !== undefined || !inputs.heardWaiting
          ? 'loading'
          : 'ready';
    const progress = state !== 'loading' ? null : self ? inputs.ownProgress : member.loading;
    const color = room.seats.find((row) => row.player === seat)?.color;
    return {
      nick: member.nick,
      color: color === undefined ? 'transparent' : playerSwatchHex(color),
      self,
      state,
      progress,
    };
  });
}

export interface StartRoster {
  update(rows: readonly StartRosterRow[]): void;
  dispose(): void;
}

/** The players plaque over the loading card: who the start waits for and how far each has loaded. */
export function mountStartRoster(): StartRoster {
  const root = document.createElement('div');
  root.className = 'boot-roster';
  root.setAttribute('role', 'status');
  const heading = document.createElement('div');
  heading.className = 'boot-roster__heading';
  const list = document.createElement('ul');
  list.className = 'boot-roster__list';
  root.append(heading, list);
  document.body.append(root);
  return {
    update(rows): void {
      const copy = messages().net.startRoster;
      heading.textContent = copy.title;
      list.replaceChildren(...rows.map((row) => rosterRow(row)));
    },
    dispose: () => root.remove(),
  };
}

function rosterRow(row: StartRosterRow): HTMLLIElement {
  const copy = messages().net.startRoster;
  const item = document.createElement('li');
  item.className = 'boot-roster__row';
  item.dataset.state = row.state;
  const swatch = span('boot-roster__swatch');
  swatch.style.background = row.color;
  const nick = span('boot-roster__nick', row.nick);
  if (row.self) nick.append(span('boot-roster__you', copy.you));
  const track = span('boot-roster__track');
  const fill = span('boot-roster__fill');
  fill.style.width = `${row.state === 'ready' ? MAX_LOADING_PROGRESS : (row.progress ?? 0)}%`;
  track.append(fill);
  const status = span(
    'boot-roster__status',
    row.state === 'loading' ? (row.progress === null ? copy.loading : `${row.progress}%`) : copy[row.state],
  );
  item.append(swatch, nick, track, status);
  return item;
}

function span(className: string, text?: string): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
