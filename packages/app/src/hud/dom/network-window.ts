import type { UiCue } from '@open-northland/audio';
import { MAX_CHAT_LENGTH } from '@open-northland/net-protocol';
import { formatMessage, messages } from '../../i18n/index.js';
import {
  type ChatLine,
  isHeldStatus,
  type NetClockModel,
  type NetLinkModel,
  type NetPanelModel,
  type NetPanelSource,
  type NetPlayerRow,
  type NetPlayerStatus,
} from '../network/model.js';
import { SPARKLINE_H, SPARKLINE_W, sparklineGeometry } from '../network/sparkline.js';
import {
  formatBehind,
  formatRoomSpeed,
  governorText,
  ownStateText,
  statusText,
  voteText,
} from '../network/text.js';
import { formatSimClock } from '../summary/model.js';
import type { ToolWindow } from '../tool-panel/window-shell.js';
import { button, element, setClass, setHidden, setTitle, write } from './parts/dom.js';
import { createSection } from './parts/section.js';
import { quietTextField } from './parts/text-field.js';
import { centralWindowPlacer, createHudWindow } from './window.js';

/** Design px: the central window width the residents window uses. */
const NETWORK_WINDOW_W = 640;
/** Design px of slack under the chat's bottom edge that still counts as following the newest line. */
const CHAT_STICK_SLACK = 8;
/** The tick cost a machine can afford at the running speed, in percent. */
const FULL_TICK_COST_PCT = 100;

const STATUS_TONE: Readonly<Record<NetPlayerStatus, 'ok' | 'warn' | 'danger'>> = {
  ok: 'ok',
  catchingUp: 'warn',
  slowing: 'warn',
  loading: 'warn',
  resync: 'warn',
  silent: 'danger',
  gone: 'danger',
};

export interface NetworkWindowDeps {
  readonly plane: HTMLElement;
  readonly source: NetPanelSource;
  readonly cue: (cue: UiCue) => void;
}

/** The network window: the room's players with their link and pace, the clock and its last two
 *  minutes, this client's own link and the room's whole chat. The plane routes its own pointer input,
 *  so it claims no canvas point. */
export interface NetworkWindow extends ToolWindow {
  /** Once a frame while open: re-place the window and redraw what changed in the model. */
  refresh(): void;
  onDismiss(listener: () => void): void;
  dispose(): void;
}

interface PlayerView {
  readonly row: HTMLElement;
  readonly chip: HTMLElement;
  readonly nick: HTMLElement;
  readonly you: HTMLElement;
  readonly tribe: HTMLElement;
  readonly status: HTMLElement;
  readonly ping: HTMLElement;
  readonly delay: HTMLElement;
  readonly cost: HTMLElement;
  readonly behind: HTMLElement;
  readonly vote: HTMLElement;
  readonly kick: HTMLButtonElement;
  seat: number | null;
}

const cell = (className: string): HTMLElement => element('span', className);

export function createNetworkWindow(deps: NetworkWindowDeps): NetworkWindow {
  const copy = messages().hud.network;
  const window = createHudWindow(deps.plane, {
    title: copy.title,
    closeLabel: messages().hud.shell.close,
    width: NETWORK_WINDOW_W,
    compact: true,
  });
  window.element.classList.add('on-window--network');
  window.body.classList.add('on-net-body');

  // Players: one parchment table, a row per member.
  const playersSection = createSection();
  playersSection.update(copy.players);
  const sheet = element('div', 'on-parchment on-net-sheet');
  const head = element('div', 'on-net-row on-net-row--head');
  const columns = copy.columns;
  const tips: Partial<Record<keyof typeof columns, string>> = copy.columnTips;
  for (const key of ['player', 'status', 'ping', 'delay', 'cost', 'behind', 'vote'] as const) {
    const label = cell('');
    label.textContent = columns[key];
    const tip = tips[key];
    if (tip !== undefined) label.title = tip;
    head.append(label);
  }
  const rows = element('div', 'on-net-rows');
  sheet.append(head, rows);

  // Clock: the figures and the lines about the pace on the left, the sparkline on the right.
  const clockSection = createSection();
  clockSection.update(copy.clock);
  const clock = element('div', 'on-net-clock');
  const figures = element('div', 'on-net-figures');
  const figure = (caption: string): HTMLElement => {
    const line = element('p', 'on-net-figure', '<span></span><b class="on-net-figure__value"></b>');
    const [label, value] = line.children;
    if (label === undefined || !(value instanceof HTMLElement)) throw new Error('network: figure');
    label.textContent = caption;
    figures.append(line);
    return value;
  };
  const requested = figure(copy.requested);
  const running = figure(copy.running);
  const governor = element('p', 'on-net-note on-net-note--warn');
  const ownState = element('p', 'on-net-note on-net-note--self');
  figures.append(governor, ownState);
  const chart = element('figure', 'on-net-chart');
  const chartTitle = element('figcaption', 'on-net-chart__title');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${SPARKLINE_W} ${SPARKLINE_H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('on-net-chart__plot');
  const chartEmpty = element('p', 'on-net-chart__empty');
  const legend = element(
    'p',
    'on-net-chart__legend',
    '<span class="on-net-chart__key on-net-chart__key--room"></span><span class="on-net-chart__key on-net-chart__key--own"></span>',
  );
  const [roomKey, ownKey] = legend.children;
  if (roomKey !== undefined) roomKey.textContent = copy.historyRoom;
  if (ownKey !== undefined) ownKey.textContent = copy.historyOwn;
  chartTitle.textContent = copy.history;
  chartEmpty.textContent = copy.historyEmpty;
  chart.append(chartTitle, svg, chartEmpty, legend);
  clock.append(figures, chart);

  // Link: this client's own connection figures.
  const linkSection = createSection();
  linkSection.update(copy.link);
  const link = element('dl', 'on-net-link');
  const linkValue = (caption: string): HTMLElement => {
    const term = element('dt', '');
    term.textContent = caption;
    const value = element('dd', '');
    link.append(term, value);
    return value;
  };
  const roundTrip = linkValue(copy.roundTrip);
  const inputDelay = linkValue(copy.inputDelay);
  const clickToApply = linkValue(copy.clickToApply);
  const buffered = linkValue(copy.buffered);
  const relay = linkValue(copy.relay);
  const disconnected = element('p', 'on-net-note on-net-note--danger');
  disconnected.textContent = copy.disconnected;

  // Chat: the whole history the model keeps, and the line to say something.
  const chatSection = createSection();
  chatSection.update(copy.chat);
  const chatSheet = element('div', 'on-parchment on-net-chat');
  const chatList = element('ol', 'on-net-chat__list');
  chatList.setAttribute('role', 'log');
  const chatEmpty = element('p', 'on-net-chat__empty');
  chatEmpty.textContent = copy.chatEmpty;
  chatSheet.append(chatList, chatEmpty);
  const say = element('label', 'on-res-field on-net-say', '<input type="text">');
  const sayInput = say.querySelector('input');
  if (sayInput === null) throw new Error('network: chat field');
  quietTextField(sayInput);
  sayInput.maxLength = MAX_CHAT_LENGTH;
  sayInput.placeholder = copy.chatPlaceholder;
  sayInput.setAttribute('aria-label', copy.chatPlaceholder);

  window.body.append(
    playersSection.element,
    sheet,
    clockSection.element,
    clock,
    linkSection.element,
    link,
    disconnected,
    chatSection.element,
    chatSheet,
    say,
  );

  // The shell leaves a text field its keys: Enter sends, Escape clears a typed line or closes.
  sayInput.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      const text = sayInput.value.trim();
      if (text.length === 0) return;
      deps.cue('confirm');
      deps.source.say(text);
      sayInput.value = '';
      return;
    }
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (sayInput.value === '') window.dismiss();
    else sayInput.value = '';
  });

  // Follows the newest line unless the player scrolled up to read.
  let stickToBottom = true;
  chatList.addEventListener('scroll', () => {
    stickToBottom = chatList.scrollTop + chatList.clientHeight >= chatList.scrollHeight - CHAT_STICK_SLACK;
  });

  const views = new Map<string, PlayerView>();
  const buildPlayer = (): PlayerView => {
    const row = element('div', 'on-net-row');
    const who = element(
      'span',
      'on-net-who',
      '<i class="on-net-chip"></i><span class="on-net-who__text"><b class="on-net-who__nick"></b><em class="on-net-you"></em><small class="on-net-who__tribe"></small></span>',
    );
    const chip = who.querySelector('i');
    const nick = who.querySelector('b');
    const you = who.querySelector('em');
    const tribe = who.querySelector('small');
    if (!(chip instanceof HTMLElement) || nick === null || !(you instanceof HTMLElement) || tribe === null) {
      throw new Error('network: player row');
    }
    you.textContent = copy.you;
    const status = cell('on-net-status');
    const ping = cell('on-net-num');
    const delay = cell('on-net-num');
    const cost = cell('on-net-num');
    const behind = cell('on-net-num');
    const vote = cell('on-net-vote');
    const kick = button('on-res-clear on-net-kick');
    const view: PlayerView = {
      row,
      chip,
      nick,
      you,
      tribe,
      status,
      ping,
      delay,
      cost,
      behind,
      vote,
      kick,
      seat: null,
    };
    kick.addEventListener('click', () => {
      if (view.seat === null) return;
      deps.cue('confirm');
      deps.source.kick(view.seat);
    });
    vote.append(kick, element('span', ''));
    row.append(who, status, ping, delay, cost, behind, vote);
    return view;
  };

  const figureOrNone = (value: number | null, format: (value: number) => string): string =>
    value === null ? copy.none : format(value);
  const ms = (value: number): string => formatMessage(copy.ms, { ms: Math.round(value) });

  const writePlayer = (view: PlayerView, player: NetPlayerRow): void => {
    view.chip.style.background = player.color ?? 'transparent';
    setClass(view.chip, 'on-net-chip--none', player.color === null);
    write(view.nick, player.nick);
    setHidden(view.you, !player.self);
    write(view.tribe, player.tribe ?? '');
    write(view.status, statusText(player));
    const tone = STATUS_TONE[player.status];
    view.status.dataset.tone = tone;
    setClass(view.row, 'on-net-row--held', isHeldStatus(player.status));
    write(view.ping, figureOrNone(player.pingMs, ms));
    write(view.delay, figureOrNone(player.delayTicks, String));
    write(
      view.cost,
      figureOrNone(player.tickCostPct, (pct) => `${Math.round(pct)}%`),
    );
    setClass(view.cost, 'on-net-num--over', (player.tickCostPct ?? 0) > FULL_TICK_COST_PCT);
    write(view.behind, player.behindTicks > 0 ? formatBehind(player.behindTicks) : copy.none);
    view.seat = player.seat;
    const vote = player.vote;
    const canKick = vote?.canVote === true && vote.voteInSeconds === 0 && player.seat !== null;
    setHidden(view.kick, !canKick);
    const note = view.vote.lastElementChild;
    if (note instanceof HTMLElement) {
      setHidden(note, vote === null || canKick);
      write(note, vote === null ? '' : voteText(vote));
    }
    if (canKick) {
      write(view.kick, formatMessage(copy.kick, { yes: vote.yes, needed: vote.needed }));
      setTitle(view.kick, formatMessage(copy.kickTitle, { nick: player.nick }));
    }
  };

  let shownPlayers: readonly NetPlayerRow[] | null = null;
  const showPlayers = (players: readonly NetPlayerRow[]): void => {
    if (players === shownPlayers) return;
    shownPlayers = players;
    const listed = new Set(players.map((player) => player.nick));
    for (const nick of views.keys()) if (!listed.has(nick)) views.delete(nick);
    const order: HTMLElement[] = [];
    for (const player of players) {
      let view = views.get(player.nick);
      if (view === undefined) {
        view = buildPlayer();
        views.set(player.nick, view);
      }
      writePlayer(view, player);
      order.push(view.row);
    }
    const current = [...rows.children];
    if (current.length !== order.length || current.some((child, index) => child !== order[index])) {
      rows.replaceChildren(...order);
    }
  };

  let shownClock: NetClockModel | null = null;
  const showClock = (model: NetPanelModel): void => {
    const state = model.clock;
    if (state === shownClock) return;
    shownClock = state;
    write(requested, formatRoomSpeed(state.requestedSpeed));
    const words = [
      formatRoomSpeed(state.runningSpeed),
      ...(state.paused ? [copy.paused] : []),
      ...(state.held ? [copy.held] : []),
    ];
    write(running, words.join(' · '));
    setClass(running, 'on-net-figure__value--governed', state.governor !== null || state.held);
    const governed = governorText(state);
    write(governor, governed ?? '');
    setHidden(governor, governed === null);
    const geometry = sparklineGeometry(state.history, state.requestedSpeed);
    const empty = state.history.length === 0;
    setHidden(chartEmpty, !empty);
    svg.innerHTML = empty
      ? ''
      : [
          ...geometry.guides.map(
            (guide) =>
              `<line class="on-net-chart__guide" x1="0" x2="${SPARKLINE_W}" y1="${guide.y}" y2="${guide.y}"/>`,
          ),
          `<polyline class="on-net-chart__room" points="${geometry.room}"/>`,
          `<polyline class="on-net-chart__own" points="${geometry.own}"/>`,
        ].join('');
  };

  let shownOwnPlayers: readonly NetPlayerRow[] | null = null;
  const showOwnState = (players: readonly NetPlayerRow[]): void => {
    if (players === shownOwnPlayers) return;
    shownOwnPlayers = players;
    const text = ownStateText(players);
    write(ownState, text ?? '');
    setHidden(ownState, text === null);
  };

  let shownLink: NetLinkModel | null = null;
  const showLink = (state: NetLinkModel): void => {
    if (state === shownLink) return;
    shownLink = state;
    write(roundTrip, figureOrNone(state.roundTripMs, ms));
    write(
      inputDelay,
      state.delayTicks === null
        ? copy.none
        : formatMessage(copy.delayValue, {
            ticks: state.delayTicks,
            ms: state.delayMs === null ? copy.none : Math.round(state.delayMs),
          }),
    );
    write(clickToApply, figureOrNone(state.clickToApplyMs, ms));
    write(buffered, formatMessage(copy.bufferedValue, { ticks: state.bufferedTicks }));
    write(
      relay,
      [
        state.relayUrl ?? copy.none,
        ...(state.relayBuild === null ? [] : [formatMessage(copy.relayBuild, { build: state.relayBuild })]),
      ].join(' · '),
    );
    setHidden(disconnected, state.connected);
  };

  const chatItem = (line: ChatLine): HTMLLIElement => {
    const item = element(
      'li',
      line.from === null ? 'on-net-chat__line on-net-chat__line--system' : 'on-net-chat__line',
    );
    if (line.tick !== null) {
      const stamp = element('time', 'on-net-chat__time');
      stamp.textContent = formatSimClock(line.tick);
      item.append(stamp);
    }
    if (line.from !== null) {
      const from = element('b', 'on-net-chat__from');
      from.textContent = `${line.from}:`;
      item.append(from);
    }
    item.append(document.createTextNode(line.text));
    return item;
  };

  let shownChatVersion = -1;
  const showChat = (model: NetPanelModel): void => {
    if (model.chatVersion === shownChatVersion) return;
    const added = model.chatVersion - shownChatVersion;
    // Appends what is new when the model still holds every line since the last draw; a reset or a
    // longer gap redraws the whole log.
    if (shownChatVersion >= 0 && added > 0 && added <= model.chat.length) {
      chatList.append(...model.chat.slice(-added).map(chatItem));
      while (chatList.childElementCount > model.chat.length) chatList.firstElementChild?.remove();
    } else {
      chatList.replaceChildren(...model.chat.map(chatItem));
    }
    shownChatVersion = model.chatVersion;
    setHidden(chatEmpty, model.chat.length > 0);
    if (stickToBottom) chatList.scrollTop = chatList.scrollHeight;
  };

  let shown: NetPanelModel | null = null;
  const draw = (): void => {
    const model = deps.source.model();
    if (model === shown || model === null) return;
    shown = model;
    showPlayers(model.players);
    showOwnState(model.players);
    showClock(model);
    showLink(model.link);
    showChat(model);
  };

  const place = centralWindowPlacer(window, deps.plane, NETWORK_WINDOW_W);
  const open = (): void => {
    window.open();
    place();
    draw();
    stickToBottom = true;
    chatList.scrollTop = chatList.scrollHeight;
  };

  return {
    isOpen: window.isOpen,
    toggle: () => (window.isOpen() ? window.close() : open()),
    close: window.close,
    claims: () => false,
    handleClick: () => false,
    refresh: () => {
      if (!window.isOpen()) return;
      place();
      draw();
    },
    onDismiss: window.onDismiss,
    dispose: window.dispose,
  };
}
