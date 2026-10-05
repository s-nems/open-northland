import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNetBanners } from '../../src/hud/dom/network-banners.js';
import { createNetworkWindow } from '../../src/hud/dom/network-window.js';
import { createHudSystemBar } from '../../src/hud/dom/system-bar.js';
import type {
  ChatLine,
  NetClockModel,
  NetLinkModel,
  NetPanelModel,
  NetPanelSource,
} from '../../src/hud/network/model.js';
import type { ToolPanelController } from '../../src/hud/tool-panel/index.js';
import { mountChatPanel } from '../../src/view/net/chat-panel.js';
import { mountNetOverlays } from '../../src/view/runtime/net-overlays.js';
import { asHtml, type FakeElement, FakeInput, installFakeDom } from '../support/fake-dom.js';

/** The network window, its banners, the minimap chat line and the speed bar over a fake DOM. */

afterEach(() => vi.unstubAllGlobals());

const REQUESTED_SPEED = 3;
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

describe('the held banner', () => {
  it('hands the notice to the window while it is open, and a lost link outranks the world', () => {
    const dom = installFakeDom();
    const plane = dom.plane();
    const feed = source(panelModel({ notice: DESYNC }));
    let open = false;
    const banners = createNetBanners({
      plane: asHtml(plane),
      source: feed,
      scale: () => 1,
      chatAnchor: () => ({ left: 0, top: 0 }),
      onOpenPanel: () => undefined,
      panelOpen: () => open,
      cue: () => undefined,
    });
    banners.refresh();
    expect(textOf(plane, '.on-net-held__notice')).toBe(DESYNC);

    open = true;
    banners.refresh();
    expect(plane.querySelector('.on-net-held')?.hidden).toBe(true);

    open = false;
    feed.current = panelModel({ notice: DESYNC, link: { ...LINK, connected: false, notice: CLOSED } });
    banners.refresh();
    expect(textOf(plane, '.on-net-held__notice')).toBe(CLOSED);
    banners.dispose();
  });
});

const enter = (): Event => Object.assign(new Event('keydown', { cancelable: true }), { key: 'Enter' });

function mountChat() {
  const dom = installFakeDom();
  const chat = mountChatPanel({
    leftPx: () => 0,
    beam: () => ({ x: 0, y: 0, w: 0, h: 0 }),
    onSend: () => undefined,
  });
  const input = dom.document.body.querySelector('input');
  if (!(input instanceof FakeInput)) throw new Error('chat input');
  return { dom, chat, input };
}

describe('the minimap chat line', () => {
  it('opens on Enter only while its log shows; the window’s field is the chat otherwise', () => {
    const { dom, chat, input } = mountChat();
    chat.setHidden(true);
    const ignored = enter();
    dom.document.dispatchEvent(ignored);
    expect(ignored.defaultPrevented).toBe(false);
    expect(input.hidden).toBe(true);

    chat.setHidden(false);
    dom.document.dispatchEvent(enter());
    expect(input.hidden).toBe(false);
    expect(dom.document.activeElement).toBe(input);
    chat.dispose();
  });

  it('closes a typed line when the window opens over it, as F9 from the line does', () => {
    const { dom, chat, input } = mountChat();
    dom.document.dispatchEvent(enter());
    input.value = 'half a';
    chat.setHidden(true);
    expect([input.hidden, input.value, dom.document.activeElement === input]).toEqual([true, '', false]);
    chat.setHidden(false);
    expect(input.hidden).toBe(true);
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

  it('moves back to the clock after a refused request, but not on a new speed sample alone', () => {
    const dom = installFakeDom();
    const synced: number[] = [];
    const controller = {
      syncSpeed: () => synced.push(synced.length),
      setSpeedLook: () => undefined,
      openNetwork: () => undefined,
      networkOpen: () => false,
    } as unknown as ToolPanelController;
    const feed = source();
    const overlays = mountNetOverlays({
      source: feed,
      plane: asHtml(dom.plane()),
      scale: () => 1,
      leftPx: () => 0,
      controller: () => controller,
      cue: () => undefined,
    });
    overlays.refresh();
    expect(synced).toHaveLength(1);

    const sampled = { ...CLOCK, history: [{ roomSpeed: REQUESTED_SPEED, ownSpeed: REQUESTED_SPEED }] };
    feed.current = panelModel({ clock: sampled });
    overlays.refresh();
    expect(synced).toHaveLength(1);

    // The feed answers a refused clock request with a new clock object over the same samples.
    feed.current = panelModel({ clock: { ...sampled } });
    overlays.refresh();
    expect(synced).toHaveLength(2);
    overlays.dispose();
  });
});
