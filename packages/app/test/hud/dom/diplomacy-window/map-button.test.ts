// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDiplomacyWindow } from '../../../../src/hud/dom/diplomacy-window/index.js';
import type { DiplomacyPanelRow } from '../../../../src/hud/dom/diplomacy-window/model.js';

// jsdom images cannot decode the stance art; the window draws its glyphs without it.
vi.mock('../../../../src/hud/dom/notices/art.js', () => ({ createNoticeArt: () => null }));

const FIRST = 1;
const SECOND = 2;
const UNLISTED = 7;

const row = (player: number): DiplomacyPanelRow => ({
  player,
  colour: 0,
  towardYou: 'neutral',
  yourStance: 'neutral',
  canDeclare: true,
  tributes: [],
  tradeOffers: [],
});

afterEach(() => document.body.replaceChildren());

function mount(onOpenMap: () => boolean = () => true) {
  let viewer = 0;
  const plane = document.createElement('div');
  document.body.append(plane);
  const rows = [row(FIRST), row(SECOND)];
  const window = createDiplomacyWindow({
    plane,
    source: {
      rows: () => rows,
      tick: () => 0,
      viewer: () => viewer,
      declare: async () => true,
      pay: async () => true,
    },
    art: '',
    paintGood: () => undefined,
    paintEmblem: () => false,
    tooltip: { show: () => undefined, hide: () => undefined },
    cue: () => undefined,
    onOpenMap,
  });
  const shownPlayer = (): string | undefined =>
    plane.querySelector<HTMLElement>('.on-dip-nation[aria-current="true"]')?.dataset.player;
  return { plane, window, shownPlayer, switchSeat: (seat: number) => (viewer = seat) };
}

describe('diplomacy window map button', () => {
  it('shuts the window once the map has opened', () => {
    const onOpenMap = vi.fn(() => true);
    const { plane, window } = mount(onOpenMap);
    window.toggle();
    plane.querySelector<HTMLButtonElement>('.on-dip-map')?.click();
    expect(onOpenMap).toHaveBeenCalledOnce();
    expect(window.isOpen()).toBe(false);
  });

  it('stays open when the map refuses', () => {
    const { plane, window } = mount(() => false);
    window.toggle();
    plane.querySelector<HTMLButtonElement>('.on-dip-map')?.click();
    expect(window.isOpen()).toBe(true);
  });

  it('keeps the asked nation through a seat change made while it was shut', () => {
    const { window, shownPlayer, switchSeat } = mount();
    switchSeat(1);
    window.showNation(SECOND);
    expect(shownPlayer()).toBe(String(SECOND));
  });
});

describe('diplomacy window showNation', () => {
  it("opens on that nation's page, and turns an open window to it", () => {
    const { window, shownPlayer } = mount();
    window.showNation(SECOND);
    expect(window.isOpen()).toBe(true);
    expect(shownPlayer()).toBe(String(SECOND));
    window.showNation(FIRST);
    expect(shownPlayer()).toBe(String(FIRST));
  });

  it('falls back to the first row for a player the window does not list', () => {
    const { window, shownPlayer } = mount();
    window.showNation(UNLISTED);
    expect(window.isOpen()).toBe(true);
    expect(shownPlayer()).toBe(String(FIRST));
  });
});
