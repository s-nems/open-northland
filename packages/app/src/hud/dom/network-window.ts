import type { UiCue } from '@open-northland/audio';
import { MAX_CHAT_LENGTH, type ResponsivenessMode, TICK_MS } from '@open-northland/net-protocol';
import { formatClockTime, formatMessage, messages } from '../../i18n/index.js';
import {
  isHeldStatus,
  type NetBallot,
  type NetChatLine,
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
import { button, element, setClass, setHidden, setTip, write } from './parts/dom.js';
import { createSection } from './parts/section.js';
import { createSegmented } from './parts/segmented.js';
import { quietTextField } from './parts/text-field.js';
import { attachTipLayer, type TipChip } from './parts/tip-layer.js';
import { centralWindowPlacer, createHudWindow } from './window.js';

/** Design px: the central window width the residents window uses. */
const NETWORK_WINDOW_W = 640;
/** Design px of slack under the chat's bottom edge that still counts as following the newest line. */
const CHAT_STICK_SLACK = 8;
/** The tick cost a machine can afford at the running speed, in percent. */
const FULL_TICK_COST_PCT = 100;
/** Design px between the cursor and the tip, and the tip's least gap to the screen edges. */
const TIP_CURSOR_GAP = 14;
const TIP_EDGE_GAP = 4;
/** Chat log lines the window reserves when the screen holds them, and the fewest a short screen keeps. */
const CHAT_LINES_FULL = 8;
const CHAT_LINES_MIN = 3;
/** Design px of one chat line: `.on-net-chat__line`'s 18 px line box and its 1 px padding each side. */
const CHAT_LINE_H = 20;
/** Design px of the sparkline's plot, and the least a short screen keeps: below it the figures beside
 *  the chart set the clock's height, so a shorter plot saves nothing. */
const PLOT_H_FULL = 64;
const PLOT_H_MIN = 48;
/** Design px above a section's caption: `.on-section`'s own, and the least a short screen keeps. */
const SECTION_GAP_FULL = 14;
const SECTION_GAP_MIN = 6;

const STATUS_TONE: Readonly<Record<NetPlayerStatus, 'ok' | 'warn' | 'danger'>> = {
  ok: 'ok',
  catchingUp: 'warn',
  slowing: 'warn',
  offline: 'warn',
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

/** The network window: the line about this client's world, the room's players with their link and
 *  pace, the clock and its last two minutes, this client's own link and the room's whole chat. The
 *  plane routes its own pointer input, so it claims no canvas point. */
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
  /** What a click on `kick` sends: a yes while `open`, the withdrawal while `cast`. */
  ballot: NetBallot | null;
}

const cell = (className: string): HTMLElement => element('span', className);

/** A reserved line: hidden keeps its box (foundation.css), so a line coming or going moves nothing. */
const showLine = (node: HTMLElement, text: string | null): void => {
  write(node, text ?? '');
  setHidden(node, text === null);
};

/** The window's tip chip, in the plane's design px: it sits on the plane, not in the window, so the
 *  window's edge never clips it. */
function planeTipChip(plane: HTMLElement): TipChip & { readonly element: HTMLElement } {
  const chip = element('p', 'on-net-tip');
  chip.setAttribute('role', 'tooltip');
  chip.hidden = true;
  plane.append(chip);
  return {
    element: chip,
    show: (clientX, clientY, text) => {
      write(chip, text);
      setHidden(chip, false);
      const bounds = plane.getBoundingClientRect();
      // Client px per design px: the plane is scaled as a whole.
      const scale = plane.clientWidth > 0 ? bounds.width / plane.clientWidth : 1;
      const x = (clientX - bounds.left) / scale;
      const y = (clientY - bounds.top) / scale;
      const right = plane.clientWidth - chip.offsetWidth - TIP_EDGE_GAP;
      const below = y + TIP_CURSOR_GAP;
      const fitsBelow = below + chip.offsetHeight + TIP_EDGE_GAP <= plane.clientHeight;
      chip.style.left = `${Math.max(TIP_EDGE_GAP, Math.min(x + TIP_CURSOR_GAP, right))}px`;
      chip.style.top = `${Math.max(TIP_EDGE_GAP, fitsBelow ? below : y - TIP_CURSOR_GAP - chip.offsetHeight)}px`;
    },
    hide: () => setHidden(chip, true),
  };
}

export function createNetworkWindow(deps: NetworkWindowDeps): NetworkWindow {
  const copy = messages().hud.network;
  const tipsCopy = copy.tips;
  const window = createHudWindow(deps.plane, {
    title: copy.title,
    closeLabel: messages().hud.shell.close,
    width: NETWORK_WINDOW_W,
    compact: true,
  });
  window.element.classList.add('on-window--network');
  window.body.classList.add('on-net-body');
  const chip = planeTipChip(deps.plane);
  const tips = attachTipLayer(window.element, chip);
  window.onDismiss(() => tips.hide());

  // The world's notice, which the status line shows while the window is closed. Every line about the
  // room keeps its height while empty, so the window's size follows only the number of players.
  const notice = element('p', 'on-net-note on-net-note--warn on-net-notice');
  notice.setAttribute('role', 'status');
  notice.hidden = true;

  // Players: one parchment table, a row per member.
  const playersSection = createSection();
  playersSection.update(copy.players);
  const sheet = element('div', 'on-parchment on-net-sheet');
  const head = element('div', 'on-net-row on-net-row--head');
  const columns = copy.columns;
  const columnTips: Partial<Record<keyof typeof columns, string>> = tipsCopy;
  for (const key of ['player', 'status', 'ping', 'delay', 'cost', 'behind', 'vote'] as const) {
    const label = cell('');
    label.textContent = columns[key];
    setTip(label, columnTips[key] ?? '');
    head.append(label);
  }
  const rows = element('div', 'on-net-rows');
  sheet.append(head, rows);

  // Clock: the figures and the lines about the pace on the left, the sparkline on the right.
  const clockSection = createSection();
  clockSection.update(copy.clock);
  const clock = element('div', 'on-net-clock');
  const figures = element('div', 'on-net-figures');
  const figure = (caption: string, tip: string): HTMLElement => {
    const line = element(
      'p',
      'on-net-figure',
      '<span class="on-net-figure__label"></span><b class="on-net-figure__value"></b>',
    );
    const [label, value] = line.children;
    if (label === undefined || !(value instanceof HTMLElement)) throw new Error('network: figure');
    label.textContent = caption;
    setTip(line, tip);
    figures.append(line);
    return value;
  };
  const requested = figure(copy.requested, tipsCopy.requested);
  const running = figure(copy.running, tipsCopy.running);
  const governor = element('p', 'on-net-note on-net-note--warn');
  governor.hidden = true;
  const ownState = element('p', 'on-net-note on-net-note--self');
  ownState.hidden = true;
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
  setTip(chart, tipsCopy.history);
  clock.append(figures, chart);

  const responseCopy = copy.responsiveness;
  const responseModes: readonly ResponsivenessMode[] = ['auto', 'responsive', 'balanced', 'smooth'];
  const response = createSegmented(responseModes, responseCopy.title, (mode) => {
    deps.cue('confirm');
    deps.source.setResponsiveness(mode);
  });
  const responseLabel = element('dt', 'on-net-response-label');
  responseLabel.textContent = responseCopy.title;
  const responseReserve = element('span', 'on-net-response-reserve');
  const responseControls = element('dd', 'on-net-response');
  responseControls.append(response.element, responseReserve);

  // Link: this client's own connection figures.
  const linkSection = createSection();
  linkSection.update(copy.link);
  const link = element('dl', 'on-net-link');
  link.append(responseLabel, responseControls);
  const linkValue = (caption: string, tip = ''): HTMLElement => {
    const term = element('dt', '');
    term.textContent = caption;
    const value = element('dd', '');
    setTip(term, tip);
    setTip(value, tip);
    link.append(term, value);
    return value;
  };
  const roundTrip = linkValue(copy.roundTrip, tipsCopy.ping);
  const inputDelay = linkValue(copy.inputDelay, tipsCopy.delay);
  const clickToApply = linkValue(copy.clickToApply);
  const buffered = linkValue(copy.buffered);
  const relay = linkValue(copy.relay);
  const disconnected = element('p', 'on-net-note on-net-note--danger');
  disconnected.hidden = true;

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

  // What a screen too short for the window scrolls; the notice and the whole chat stay in view.
  const scroll = element('div', 'on-net-scroll');
  scroll.append(
    playersSection.element,
    sheet,
    clockSection.element,
    clock,
    linkSection.element,
    link,
    disconnected,
  );
  window.body.append(notice, scroll, chatSection.element, chatSheet, say);

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
    setTip(ping, tipsCopy.ping);
    const delay = cell('on-net-num');
    setTip(delay, tipsCopy.delay);
    const cost = cell('on-net-num');
    setTip(cost, tipsCopy.cost);
    const behind = cell('on-net-num');
    setTip(behind, tipsCopy.behind);
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
      ballot: null,
    };
    kick.addEventListener('click', () => {
      if (view.seat === null || view.ballot === null) return;
      deps.cue('confirm');
      deps.source.kick(view.seat, view.ballot === 'open');
    });
    const voteNote = element('span', 'on-net-vote__note');
    setTip(voteNote, tipsCopy.vote);
    vote.append(kick, voteNote);
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
    const ballot = player.seat === null ? null : (vote?.ballot ?? null);
    view.ballot = ballot;
    setHidden(view.kick, ballot === null);
    const note = view.vote.lastElementChild;
    if (note instanceof HTMLElement) {
      setHidden(note, vote === null || ballot !== null);
      write(note, vote === null ? '' : voteText(vote));
    }
    if (vote !== null && ballot !== null) {
      const tally = { yes: vote.yes, needed: vote.needed };
      write(view.kick, formatMessage(ballot === 'open' ? copy.kick : copy.withdraw, tally));
      setTip(
        view.kick,
        formatMessage(ballot === 'open' ? copy.kickTitle : copy.withdrawTitle, { nick: player.nick }),
      );
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
    showLine(governor, governorText(state));
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
    showLine(ownState, ownStateText(players));
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
    showLine(disconnected, state.notice);
    setTip(disconnected, state.notice ?? '');
  };

  const chatItem = (line: NetChatLine): HTMLLIElement => {
    const item = element(
      'li',
      line.from === null ? 'on-net-chat__line on-net-chat__line--system' : 'on-net-chat__line',
    );
    const stamp = element('time', 'on-net-chat__time');
    stamp.setAttribute('datetime', new Date(line.at).toISOString());
    stamp.textContent =
      line.tick === null
        ? formatClockTime(line.at)
        : `${formatClockTime(line.at)} (${formatSimClock(line.tick)})`;
    setTip(stamp, tipsCopy.chatTime);
    item.append(stamp);
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

  const sectionCount = [playersSection, clockSection, linkSection, chatSection].length;
  const chatRange = CHAT_LINES_FULL - CHAT_LINES_MIN;
  const plotRange = PLOT_H_FULL - PLOT_H_MIN;
  const gapRange = SECTION_GAP_FULL - SECTION_GAP_MIN;
  /** Design px the reserved heights can give up in all. */
  const shrinkable = chatRange * CHAT_LINE_H + plotRange + sectionCount * gapRange;
  /** Every reserved height gives up `share` (0..1) of its range, rounded to give up at least that much. */
  const reserve = (share: number): void => {
    const style = window.element.style;
    style.setProperty('--net-chat-lines', String(CHAT_LINES_FULL - Math.ceil(share * chatRange)));
    style.setProperty('--net-plot-h', `${PLOT_H_FULL - Math.ceil(share * plotRange)}px`);
    style.setProperty('--net-section-gap', `${SECTION_GAP_FULL - Math.ceil(share * gapRange)}px`);
  };
  // The reserved heights follow the room the window has, never its text: once per region height and
  // player count, measured with every reservation full, they give up the same share of their range
  // to whatever overflows. What still overflows scrolls.
  let fitted = '';
  const fit = (): void => {
    const key = `${window.element.style.maxHeight}|${rows.childElementCount}`;
    if (key === fitted) return;
    fitted = key;
    reserve(0);
    const overflow = scroll.scrollHeight - scroll.clientHeight;
    if (overflow > 0) reserve(Math.min(1, overflow / shrinkable));
    if (stickToBottom) chatList.scrollTop = chatList.scrollHeight;
  };

  let shown: NetPanelModel | null = null;
  const draw = (): void => {
    const model = deps.source.model();
    if (model === shown || model === null) return;
    shown = model;
    showLine(notice, model.notice?.text ?? null);
    setTip(notice, model.notice?.tip ?? '');
    showPlayers(model.players);
    showOwnState(model.players);
    showClock(model);
    showLink(model.link);
    const bufferMs = Math.round((model.responsiveness.bufferTicks * TICK_MS) / model.clock.runningSpeed);
    const reserveTip = formatMessage(responseCopy.reserve, { ms: bufferMs });
    const responseOption = (mode: ResponsivenessMode) => ({
      label: responseCopy.options[mode],
      enabled: model.link.connected,
      tooltip: `${responseCopy.options[mode]}. ${responseCopy.hints[mode]}${
        mode === model.responsiveness.mode ? ` ${reserveTip}` : ''
      }`,
    });
    response.update(
      {
        auto: responseOption('auto'),
        responsive: responseOption('responsive'),
        balanced: responseOption('balanced'),
        smooth: responseOption('smooth'),
      },
      model.responsiveness.mode,
    );
    write(responseReserve, ms(bufferMs));
    setTip(responseReserve, reserveTip);
    showChat(model);
  };

  const place = centralWindowPlacer(window, deps.plane, NETWORK_WINDOW_W);
  const close = (): void => {
    tips.hide();
    window.close();
  };
  const open = (): void => {
    window.open();
    place();
    draw();
    fit();
    stickToBottom = true;
    chatList.scrollTop = chatList.scrollHeight;
  };

  return {
    isOpen: window.isOpen,
    toggle: () => (window.isOpen() ? close() : open()),
    close,
    claims: () => false,
    handleClick: () => false,
    refresh: () => {
      if (!window.isOpen()) return;
      place();
      draw();
      fit();
      tips.refresh();
    },
    onDismiss: window.onDismiss,
    dispose: () => {
      tips.dispose();
      chip.element.remove();
      window.dispose();
    },
  };
}
