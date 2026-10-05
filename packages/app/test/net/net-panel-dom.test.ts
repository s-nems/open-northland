import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNetStatusLine } from '../../src/hud/dom/network-status-line.js';
import { createNetworkWindow } from '../../src/hud/dom/network-window.js';
import { createHudSystemBar } from '../../src/hud/dom/system-bar.js';
import type {
  ChatLine,
  NetClockModel,
  NetLinkModel,
  NetPanelModel,
  NetPanelSource,
  NetPlayerRow,
} from '../../src/hud/network/model.js';
import type { ToolPanelController } from '../../src/hud/tool-panel/index.js';
import { CHAT_LINGER_MS, mountChatPanel } from '../../src/view/net/chat-panel.js';
import { mountNetOverlays } from '../../src/view/runtime/net-overlays.js';
import { asHtml, type FakeElement, FakeInput, installFakeDom } from '../support/fake-dom.js';

/** The network window, its status line, the minimap chat and the speed bar over a fake DOM. */

afterEach(() => vi.unstubAllGlobals());

const REQUESTED_SPEED = 3;
const GOVERNED_SPEED = 2;
const DESYNC = 'Out of sync with Bartek';
const CLOSED = 'The relay closed the link';
/** The chat history's cap in the models below, small enough to overrun in a test. */
const CHAT_CAP = 3;

const CLOCK: NetClockModel = {
  requestedSpeed: REQUESTED_SPEED,
  runningSpeed: REQUESTED_SPEED,
  paused: false,
  held: false,
  governor: null,
  history: [],
};

const LINK: NetLinkModel = {
  connected: true,
  roundTripMs: null,
  delayTicks: null,
  delayMs: null,
  clickToApplyMs: null,
  bufferedTicks: 0,
  relayUrl: null,
  relayBuild: null,
  notice: null,
};

const panelModel = (overrides: Partial<NetPanelModel> = {}): NetPanelModel => ({
  players: [],
  clock: CLOCK,
  link: LINK,
  chat: [],
  chatVersion: 0,
  notice: null,
  ...overrides,
});

/** A source whose model the test swaps. */
function source(first: NetPanelModel = panelModel()): NetPanelSource & { current: NetPanelModel } {
  return {
    current: first,
    model() {
      return this.current;
    },
    kick: () => undefined,
    say: () => undefined,
  };
}

const said = (index: number): ChatLine => ({ from: 'Ania', text: `line ${index}`, tick: null });

const textOf = (root: FakeElement, selector: string): string | null => {
  const node = root.querySelector(selector);
  return node === null || node.hidden ? null : node.textContent;
};

function mountWindow(feed: NetPanelSource) {
  const dom = installFakeDom();
  const plane = dom.plane();
  const window = createNetworkWindow({ plane: asHtml(plane), source: feed, cue: () => undefined });
  window.toggle();
  return { plane, window };
}

describe('the network window', () => {
  it('shows the world’s notice above the players and a lost link’s own words in its link section', () => {
    const feed = source(panelModel({ notice: DESYNC }));
    const { plane, window } = mountWindow(feed);
    const body = plane.querySelector('.on-window__body');
    expect(body?.firstElementChild?.classList.contains('on-net-notice')).toBe(true);
    expect(textOf(plane, '.on-net-notice')).toBe(DESYNC);
    expect(textOf(plane, '.on-net-note--danger')).toBeNull();

    feed.current = panelModel({ link: { ...LINK, connected: false, notice: CLOSED } });
    window.refresh();
    expect(textOf(plane, '.on-net-notice')).toBeNull();
    expect(textOf(plane, '.on-net-note--danger')).toBe(CLOSED);
  });

  it('appends only the new chat lines and drops the oldest past the cap', () => {
    const lines = [said(0), said(1)];
    const feed = source(panelModel({ chat: lines, chatVersion: lines.length }));
    const { plane, window } = mountWindow(feed);
    const list = plane.querySelector('.on-net-chat__list');
    const first = list?.firstElementChild;
    expect(list?.childElementCount).toBe(2);

    const grown = [...lines, said(2)];
    feed.current = panelModel({ chat: grown, chatVersion: grown.length });
    window.refresh();
    expect(list?.childElementCount).toBe(CHAT_CAP);
    expect(list?.firstElementChild).toBe(first);

    const capped = [...grown, said(3), said(4)].slice(-CHAT_CAP);
    feed.current = panelModel({ chat: capped, chatVersion: grown.length + 2 });
    window.refresh();
    expect(list?.childElementCount).toBe(CHAT_CAP);
    expect(list?.children.map((item) => item.textContent)).toEqual([
      'Ania:line 2',
      'Ania:line 3',
      'Ania:line 4',
    ]);
  });
});

const GOVERNED: NetClockModel = {
  ...CLOCK,
  runningSpeed: GOVERNED_SPEED,
  governor: { nick: 'Celina', cause: 'load' },
};

describe('the net status line', () => {
  it('says the slowed room, a notice over it, a lost link over the world, and nothing while the window is open', () => {
    const dom = installFakeDom();
    const plane = dom.plane();
    const feed = source(panelModel({ clock: GOVERNED }));
    let open = false;
    const line = createNetStatusLine({
      source: feed,
      panelOpen: () => open,
      onOpenPanel: () => undefined,
      cue: () => undefined,
    });
    plane.append(line.element as unknown as FakeElement);
    line.refresh();
    expect(textOf(plane, '.on-net-slowed')).toContain('Celina');
    expect(plane.querySelector('.on-net-slowed--notice')).toBeNull();

    feed.current = panelModel({ clock: GOVERNED, notice: DESYNC });
    line.refresh();
    expect(textOf(plane, '.on-net-slowed--notice')).toBe(DESYNC);

    feed.current = panelModel({ notice: DESYNC, link: { ...LINK, connected: false, notice: CLOSED } });
    line.refresh();
    expect(textOf(plane, '.on-net-slowed')).toBe(CLOSED);

    open = true;
    line.refresh();
    expect(textOf(plane, '.on-net-slowed')).toBeNull();
  });
});

const row = (nick: string, status: NetPlayerRow['status']): NetPlayerRow => ({
  nick,
  seat: null,
  self: false,
  color: null,
  tribe: null,
  status,
  pingMs: null,
  delayTicks: null,
  tickCostPct: null,
  behindTicks: 0,
  loadingPercent: null,
  vote: null,
});
const HOLDING = panelModel({ players: [row('Bartek', 'gone')], clock: { ...CLOCK, held: true } });
const RUNNING = panelModel({ players: [row('Bartek', 'ok')] });

/** A tool panel controller with a network window the test can see and press. */
function fakeController() {
  const state = { open: false, opens: 0, closes: 0, hung: null as HTMLElement | null, synced: 0 };
  const controller = {
    syncSpeed: () => {
      state.synced += 1;
    },
    setSpeedLook: () => undefined,
    openNetwork: () => {
      state.opens += 1;
      state.open = true;
    },
    closeNetwork: () => {
      state.closes += 1;
      state.open = false;
    },
    networkOpen: () => state.open,
    hangBesideBar: (node: HTMLElement | null) => {
      state.hung = node;
    },
  } as unknown as ToolPanelController;
  return { state, controller };
}

function mountOverlays(feed: NetPanelSource, now: () => number = () => 0) {
  installFakeDom();
  const { state, controller } = fakeController();
  const overlays = mountNetOverlays({
    source: feed,
    scale: () => 1,
    minimap: () => null,
    controller: () => controller,
    cue: () => undefined,
    now,
  });
  return { state, overlays };
}

describe('the network window over a hold', () => {
  it('opens by itself when the room waits for someone and closes by itself when it stops', () => {
    const feed = source(RUNNING);
    const { state, overlays } = mountOverlays(feed);
    overlays.refresh();
    expect(state.open).toBe(false);

    feed.current = HOLDING;
    overlays.refresh();
    overlays.refresh();
    expect([state.open, state.opens]).toEqual([true, 1]);

    feed.current = RUNNING;
    overlays.refresh();
    expect([state.open, state.closes]).toEqual([false, 1]);
    overlays.dispose();
  });

  it('stays open after the hold when the player had it open, or closed and reopened it meanwhile', () => {
    const feed = source(RUNNING);
    const { state, overlays } = mountOverlays(feed);
    state.open = true;
    overlays.refresh();
    feed.current = HOLDING;
    overlays.refresh();
    expect(state.opens).toBe(0);
    feed.current = RUNNING;
    overlays.refresh();
    expect(state.open).toBe(true);

    state.open = false;
    overlays.refresh();
    feed.current = HOLDING;
    overlays.refresh();
    expect(state.opens).toBe(1);
    state.open = false;
    overlays.refresh();
    state.open = true;
    feed.current = RUNNING;
    overlays.refresh();
    expect([state.open, state.closes]).toEqual([true, 0]);
    overlays.dispose();
  });

  it('hangs the status line beside the bar and takes it down on dispose', () => {
    const { state, overlays } = mountOverlays(source());
    overlays.refresh();
    expect(state.hung?.classList.contains('on-net-slowed')).toBe(true);
    overlays.dispose();
    expect(state.hung).toBeNull();
  });
});

const enter = (): Event => Object.assign(new Event('keydown', { cancelable: true }), { key: 'Enter' });
const escapeKey = (): Event => Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });

function mountChat(now: () => number = () => 0) {
  const dom = installFakeDom();
  const chat = mountChatPanel({
    scale: () => 1,
    minimap: () => null,
    beam: () => ({ x: 0, y: 0, w: 0, h: 0 }),
    onSend: () => undefined,
    now,
  });
  const input = dom.document.body.querySelector('input');
  const lines = input?.parent?.firstElementChild;
  if (!(input instanceof FakeInput) || lines === undefined || lines === null) throw new Error('chat input');
  return { dom, chat, input, lines };
}

const lineOpen = (input: FakeInput): boolean => input.style.visibility === 'visible';

describe('the minimap chat', () => {
  it('shows a new line, fades after it lingers, and comes back while the line is open', () => {
    let clock = 0;
    const { dom, chat, input, lines } = mountChat(() => clock);
    chat.refresh([], 0);
    expect(lines.style.opacity).toBe('0');

    chat.refresh([said(0)], 1);
    expect(lines.style.opacity).toBe('1');
    clock = CHAT_LINGER_MS;
    chat.refresh([said(0)], 1);
    expect(lines.style.opacity).toBe('0');

    dom.document.dispatchEvent(enter());
    expect([lines.style.opacity, lineOpen(input)]).toEqual(['1', true]);
    input.dispatchEvent(escapeKey());
    expect([lines.style.opacity, lineOpen(input)]).toEqual(['0', false]);
    chat.dispose();
  });

  it('opens on Enter only while its log shows; the window’s field is the chat otherwise', () => {
    const { dom, chat, input } = mountChat();
    chat.setHidden(true);
    const ignored = enter();
    dom.document.dispatchEvent(ignored);
    expect(ignored.defaultPrevented).toBe(false);
    expect(lineOpen(input)).toBe(false);

    chat.setHidden(false);
    dom.document.dispatchEvent(enter());
    expect(lineOpen(input)).toBe(true);
    expect(dom.document.activeElement).toBe(input);
    chat.dispose();
  });

  it('closes a typed line when the window opens over it, as F9 from the line does', () => {
    const { dom, chat, input } = mountChat();
    dom.document.dispatchEvent(enter());
    input.value = 'half a';
    chat.setHidden(true);
    expect([lineOpen(input), input.value, dom.document.activeElement === input]).toEqual([false, '', false]);
    chat.setHidden(false);
    expect(lineOpen(input)).toBe(false);
    chat.dispose();
  });
});

describe('the speed bar', () => {
  it('refuses its segments while the room is held and takes them again after', () => {
    const dom = installFakeDom();
    const plane = dom.plane();
    const pressed: string[] = [];
    const bar = createHudSystemBar(asHtml(plane), {
      summary: { pack: null, goodIdOf: () => undefined, goodLabel: (id) => id },
      onPauseToggle: () => pressed.push('pause'),
      onSpeed: (running) => pressed.push(running),
      onMenu: () => undefined,
    });
    bar.setSpeed({ running: 'normal', paused: false });
    const segments = plane.querySelector('.on-speed')?.children ?? [];
    expect(segments.length).toBeGreaterThan(1);

    bar.setLook({ kind: 'held', title: 'held' });
    for (const segment of segments) segment.click();
    expect(pressed).toEqual([]);
    expect(plane.querySelector('.on-speed')?.getAttribute('aria-disabled')).toBe('true');

    bar.setLook(null);
    segments[0]?.click();
    expect(pressed).toEqual(['pause']);
    bar.dispose();
  });

  it('hangs a note in its aside and takes it down again', () => {
    const dom = installFakeDom();
    const plane = dom.plane();
    const bar = createHudSystemBar(asHtml(plane), {
      summary: { pack: null, goodIdOf: () => undefined, goodLabel: (id) => id },
      onPauseToggle: () => undefined,
      onSpeed: () => undefined,
      onMenu: () => undefined,
    });
    const note = dom.document.createElement('button');
    bar.setAside(asHtml(note));
    expect(plane.querySelector('.on-bar__aside')?.firstElementChild).toBe(note);
    bar.setAside(null);
    expect(plane.querySelector('.on-bar__aside')?.childElementCount).toBe(0);
    bar.dispose();
  });

  it('moves back to the clock after a refused request, but not on a new speed sample alone', () => {
    const feed = source();
    const { state, overlays } = mountOverlays(feed);
    overlays.refresh();
    expect(state.synced).toBe(1);

    const sampled = { ...CLOCK, history: [{ roomSpeed: REQUESTED_SPEED, ownSpeed: REQUESTED_SPEED }] };
    feed.current = panelModel({ clock: sampled });
    overlays.refresh();
    expect(state.synced).toBe(1);

    // The feed answers a refused clock request with a new clock object over the same samples.
    feed.current = panelModel({ clock: { ...sampled } });
    overlays.refresh();
    expect(state.synced).toBe(2);
    overlays.dispose();
  });
});
