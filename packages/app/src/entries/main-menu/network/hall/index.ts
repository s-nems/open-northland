import type { SessionWorld } from '@open-northland/lockstep';
import type { RelayClientView } from '@open-northland/net-client';
import {
  type HallChatLine,
  MAX_CHAT_LENGTH,
  MAX_ROOM_PASSWORD_LENGTH,
  type RelayReason,
  type RoomSummary,
} from '@open-northland/net-protocol';
import { quietPasswordField, quietTextField } from '../../../../hud/dom/parts/text-field.js';
import { bcp47Tag, formatMessage, messages, pluralForm } from '../../../../i18n/index.js';
import { node } from '../../dom.js';
import { nickWithFlag } from '../flags/catalog.js';
import { button } from '../parts.js';
import { formatAgo, formatChatStamp, formatPlayed, hallRooms, type OnlineRow, onlineRows } from './model.js';

/** Chat lines kept on screen; the relay replays at most as many. */
const CHAT_LOG_LINES = 200;
/** A log scrolled this close to its end follows new lines. */
const FOLLOW_SLACK_PX = 32;
/** How often running clocks and "seen ago" times are rewritten. */
const TICK_MS = 1000;
/** The padlock beside a room that asks a password. */
const LOCK_GLYPH =
  '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3M12 15v2"/></svg>';

export type HallClient = Pick<
  RelayClientView,
  'nick' | 'rooms' | 'online' | 'recent' | 'hallChat' | 'sayInHall'
>;

export interface HallDeps {
  /** The connected client, null while there is none. */
  readonly client: () => HallClient | null;
  readonly worldTitle: (world: SessionWorld) => string;
  readonly join: (roomId: string, password?: string) => void;
}

/**
 * What a connected player sees outside a room: the games on the server, who is on it, and its chat.
 * Each part repaints from the client's state when the relay's matching message arrives.
 */
export function networkHall(deps: HallDeps) {
  const copy = messages().network;
  let enabled = false;
  const joins: HTMLButtonElement[] = [];
  /** Running rooms' clocks, extrapolated from the summary since it arrived. */
  let clocks: { readonly time: HTMLElement; readonly playedMs: number }[] = [];
  let roomsAt = performance.now();
  /** The list `roomsAt` dates; the client holds a new array per `rooms` message. */
  let roomsShown: readonly RoomSummary[] | null = null;
  let ago: { readonly time: HTMLElement; readonly at: number }[] = [];
  /** The room the last join asked for. */
  let joining: string | null = null;
  /** The open password field of a locked room's Join, kept by room id: the list is rebuilt on every
   *  `rooms` message, and the field moves into the new row with its text. */
  let asking: PasswordAsk | null = null;

  const openList = node('div', 'network-menu__rooms');
  const runningList = node('div', 'network-menu__rooms');
  const openCount = node('span', 'network-hall__count');
  const runningCount = node('span', 'network-hall__count');
  const rooms = node('section', 'network-menu__room-list network-hall__games');
  rooms.tabIndex = -1;
  const roomsHead = node('header', 'network-menu__section-head');
  roomsHead.append(node('h2', '', copy.rooms));
  rooms.append(
    roomsHead,
    subhead(copy.openRooms, openCount),
    openList,
    subhead(copy.runningGames, runningCount),
    runningList,
  );
  openList.append(node('p', 'network-menu__muted', copy.loadingRooms));

  const onlineCount = node('span', 'network-hall__count');
  const recentCount = node('span', 'network-hall__count');
  const onlineList = node('ul', 'network-hall__people');
  const recentList = node('ul', 'network-hall__people network-hall__people--recent');
  const recentHead = subhead(copy.recentPlayers, recentCount);
  const players = node('section', 'network-hall__card network-hall__players');
  players.append(
    node('h2', '', copy.players),
    subhead(copy.onlinePlayers, onlineCount),
    onlineList,
    recentHead,
    recentList,
  );

  const chat = node('section', 'network-hall__card network-hall__chat');
  const chatHead = node('header', 'network-hall__chat-head');
  chatHead.append(node('h2', '', copy.hallChat), node('p', 'network-menu__muted', copy.hallChatHint));
  const log = node('div', 'network-hall__chat-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-label', copy.hallChat);
  log.tabIndex = 0;
  const chatEmpty = node('p', 'network-hall__chat-empty', copy.hallChatEmpty);
  const form = node('form', 'network-hall__chat-form');
  const input = quietTextField(node('input'));
  input.type = 'text';
  input.maxLength = MAX_CHAT_LENGTH;
  input.placeholder = copy.hallChatPlaceholder;
  input.setAttribute('aria-label', copy.hallChatPlaceholder);
  const send = button(copy.send, () => undefined);
  send.type = 'submit';
  form.append(input, send);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!enabled || text === '') return;
    deps.client()?.sayInHall(text);
    input.value = '';
  });
  input.addEventListener('keydown', (event) => {
    if (event.isComposing && event.key === 'Enter') event.preventDefault();
  });
  chat.append(chatHead, chatEmpty, log, form);

  const tag = bcp47Tag();
  const chatRow = (line: HallChatLine, now: number, nick: string): HTMLElement => {
    const row = node('p', line.from === nick ? 'is-own' : '');
    if (line.from !== nick && mentions(line.text, nick)) row.classList.add('is-mention');
    const time = node('time', 'network-hall__chat-time', formatChatStamp(line.at, now, tag));
    time.setAttribute('datetime', new Date(line.at).toISOString());
    row.append(time, nickWithFlag('strong', '', line.from, line.flag), node('span', '', line.text));
    return row;
  };

  const join = (roomId: string, password?: string): void => {
    joining = roomId;
    deps.join(roomId, password);
  };
  const closePassword = (focus: HTMLElement | null): void => {
    const closing = asking;
    if (closing === null) return;
    asking = null;
    closing.form.remove();
    closing.join?.setAttribute('aria-expanded', 'false');
    focus?.focus();
  };
  const askPassword = (roomId: string): PasswordAsk => {
    const form = node('form', 'network-hall__password');
    const input = quietPasswordField(node('input'));
    input.maxLength = MAX_ROOM_PASSWORD_LENGTH;
    input.placeholder = copy.joinPassword;
    input.setAttribute('aria-label', copy.joinPassword);
    const confirm = button(copy.joinConfirm, () => undefined);
    confirm.type = 'submit';
    confirm.disabled = !enabled;
    const refusal = node('p', 'network-hall__password-refusal');
    refusal.setAttribute('role', 'status');
    refusal.hidden = true;
    form.append(input, confirm, refusal);
    const ask: PasswordAsk = { roomId, form, input, confirm, refusal, join: null };
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const password = input.value.trim();
      if (!enabled) return;
      if (password === '') input.focus();
      else join(roomId, password);
    });
    input.addEventListener('keydown', (event) => {
      if (event.isComposing) {
        if (event.key === 'Enter') event.preventDefault();
        return;
      }
      if (event.key !== 'Escape') return;
      // Escape here closes the field only, never the screen or the menu behind it.
      event.preventDefault();
      event.stopPropagation();
      closePassword(ask.join);
    });
    input.addEventListener('input', () => {
      refusal.hidden = true;
      input.removeAttribute('aria-invalid');
    });
    return ask;
  };

  const roomRow = (room: RoomSummary): HTMLElement => {
    const row = node('div', 'network-menu__room-row network-hall__room');
    const main = node('div', 'network-hall__room-main');
    const meta = node(
      'p',
      'network-hall__room-meta',
      `${deps.worldTitle(room.world)} · ${formatMessage(copy.roomCapacity, {
        members: formatMessage(pluralForm(room.members.length, copy.members, tag), {
          count: room.members.length,
        }),
        seats: room.seats,
      })}`,
    );
    const nicks = node('ul', 'network-hall__nicks');
    nicks.append(...room.members.map((nick) => node('li', '', nick)));
    const name = node('strong', 'network-hall__room-name', room.name);
    if (room.locked) {
      const lock = node('span', 'network-hall__lock');
      lock.innerHTML = LOCK_GLYPH;
      lock.setAttribute('role', 'img');
      lock.setAttribute('aria-label', copy.lockedRoom);
      lock.title = copy.lockedRoom;
      name.append(lock);
    }
    main.append(name, meta, nicks);
    row.append(main);
    if (room.state === 'lobby') {
      const press = button(copy.join, () => {
        if (!enabled) return;
        if (!room.locked) {
          join(room.id);
          return;
        }
        if (asking?.roomId !== room.id) {
          closePassword(null);
          asking = askPassword(room.id);
          asking.join = press;
          press.setAttribute('aria-expanded', 'true');
          row.append(asking.form);
        }
        asking.input.focus();
      });
      press.disabled = !enabled;
      joins.push(press);
      row.append(press);
      if (room.locked) press.setAttribute('aria-expanded', String(asking?.roomId === room.id));
      if (asking?.roomId === room.id) {
        asking.join = press;
        row.append(asking.form);
      }
    } else if (room.playedMs === null) {
      row.append(node('span', 'network-hall__badge', copy.gameLoading));
    } else {
      const clock = node('div', 'network-hall__clock');
      const time = node('time', '', formatPlayed(room.playedMs + performance.now() - roomsAt));
      clock.append(node('span', '', copy.playedFor), time);
      clocks.push({ time, playedMs: room.playedMs });
      row.append(clock);
    }
    return row;
  };

  const whereText = (row: OnlineRow): string => {
    switch (row.where.kind) {
      case 'hall':
        return copy.lookingForGame;
      case 'lobby':
        return formatMessage(copy.inRoom, { room: row.where.room });
      case 'playing':
        return formatMessage(copy.playingIn, { room: row.where.room });
    }
  };

  const tick = (): void => {
    const sinceRooms = performance.now() - roomsAt;
    for (const clock of clocks) clock.time.textContent = formatPlayed(clock.playedMs + sinceRooms);
    const now = Date.now();
    for (const entry of ago) {
      const text = formatAgo(entry.at, now, tag) ?? copy.justNow;
      if (entry.time.textContent !== text) entry.time.textContent = text;
    }
  };
  const timer = setInterval(tick, TICK_MS);

  const showPresence = (): void => {
    const client = deps.client();
    if (client === null) return;
    const now = Date.now();
    const online = onlineRows(client.online, client.rooms, client.nick);
    onlineCount.textContent = String(online.length);
    onlineList.replaceChildren(
      ...online.map((row) => {
        const item = node('li', `is-online is-${row.where.kind}${row.self ? ' is-self' : ''}`);
        const name = nickWithFlag('span', 'network-hall__nick', row.nick, row.flag);
        if (row.self) name.append(node('em', '', copy.you));
        item.append(
          node('i', 'network-hall__dot'),
          name,
          node('span', 'network-hall__where', whereText(row)),
        );
        return item;
      }),
    );
    ago = [];
    recentCount.textContent = String(client.recent.length);
    recentList.replaceChildren(
      ...client.recent.map((player) => {
        const item = node('li', 'is-away');
        const time = node('time', 'network-hall__where', formatAgo(player.at, now, tag) ?? copy.justNow);
        time.setAttribute('datetime', new Date(player.at).toISOString());
        ago.push({ time, at: player.at });
        item.append(node('i', 'network-hall__dot'), node('span', 'network-hall__nick', player.nick), time);
        return item;
      }),
    );
    if (client.recent.length === 0) recentList.append(node('li', 'network-hall__none', copy.noRecentPlayers));
  };

  return {
    rooms,
    players,
    chat,
    /** The room list changed, or the names its maps show. */
    showRooms(): void {
      const client = deps.client();
      if (client === null) return;
      const { open, running } = hallRooms(client.rooms);
      if (client.rooms !== roomsShown) {
        roomsShown = client.rooms;
        roomsAt = performance.now();
      }
      clocks = [];
      joins.length = 0;
      openCount.textContent = String(open.length);
      runningCount.textContent = String(running.length);
      // Detaching the field drops its focus and caret, which the new row then gets back.
      const field = asking?.input;
      const typing =
        field !== undefined && document.activeElement === field
          ? { start: field.selectionStart, end: field.selectionEnd }
          : null;
      if (asking !== null && !open.some((room) => room.id === asking?.roomId))
        closePassword(typing === null ? null : rooms);
      openList.replaceChildren(...open.map(roomRow));
      if (typing !== null && asking !== null) {
        asking.input.focus();
        asking.input.setSelectionRange(typing.start, typing.end);
      }
      if (open.length === 0) {
        const empty = node('div', 'network-menu__empty');
        empty.append(node('h3', '', copy.emptyTitle), node('p', '', copy.empty));
        openList.append(empty);
      }
      runningList.replaceChildren(...running.map(roomRow));
      if (running.length === 0) runningList.append(node('p', 'network-hall__none', copy.noRunningGames));
      // Whereabouts name rooms, so they follow the list.
      showPresence();
    },
    showPresence,
    /** The relay's whole chat, as it replays it to a player arriving outside a room. */
    showChat(): void {
      const client = deps.client();
      if (client === null) return;
      const now = Date.now();
      const lines = client.hallChat.slice(-CHAT_LOG_LINES);
      chatEmpty.hidden = lines.length > 0;
      log.replaceChildren(...lines.map((line) => chatRow(line, now, client.nick)));
      log.scrollTop = log.scrollHeight;
    },
    observeChat(line: HallChatLine): void {
      const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < FOLLOW_SLACK_PX;
      chatEmpty.hidden = true;
      const nick = deps.client()?.nick ?? '';
      log.append(chatRow(line, Date.now(), nick));
      while (log.childElementCount > CHAT_LOG_LINES) log.firstElementChild?.remove();
      if (atEnd || line.from === nick) log.scrollTop = log.scrollHeight;
    },
    enable(on: boolean): void {
      enabled = on;
      input.disabled = !on;
      send.disabled = !on;
      for (const join of joins) join.disabled = !on;
      if (asking !== null) asking.confirm.disabled = !on;
    },
    /** The relay refused the last join; true when the open password field shows why. Only a password
     *  refusal stays there: any other closes the field, whose row may leave the list on the next
     *  repaint and take the text with it. */
    joinRefused(reason: RelayReason, text: string): boolean {
      if (asking === null || asking.roomId !== joining) return false;
      if (reason.code !== 'wrongPassword' && reason.code !== 'retryTooSoon') {
        closePassword(rooms);
        return false;
      }
      asking.refusal.textContent = text;
      asking.refusal.hidden = false;
      if (reason.code === 'wrongPassword') {
        asking.input.setAttribute('aria-invalid', 'true');
        asking.input.focus();
        asking.input.select();
      }
      return true;
    },
    /** Closes the password field, as entering a room or leaving the server does. */
    closePassword(): void {
      closePassword(null);
    },
    dispose(): void {
      clearInterval(timer);
    },
  };
}

interface PasswordAsk {
  readonly roomId: string;
  readonly form: HTMLFormElement;
  readonly input: HTMLInputElement;
  readonly confirm: HTMLButtonElement;
  readonly refusal: HTMLElement;
  /** The room row's Join button, replaced with the row on every repaint. */
  join: HTMLButtonElement | null;
}

function subhead(text: string, count: HTMLElement): HTMLElement {
  const head = node('h3', 'network-hall__subhead', text);
  head.append(count);
  return head;
}

/** Whether `text` names `nick` as a word of its own, in any case. */
function mentions(text: string, nick: string): boolean {
  const at = text.toLocaleLowerCase().indexOf(nick.toLocaleLowerCase());
  if (at < 0) return false;
  const word = /[\p{L}\p{N}_]/u;
  const before = text[at - 1];
  const after = text[at + nick.length];
  return (before === undefined || !word.test(before)) && (after === undefined || !word.test(after));
}
