import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { WIN_PAD } from '../src/hud/chrome.js';
import type { TextRun } from '../src/hud/text-run.js';
import type { PanelContext } from '../src/hud/tool-panel/context.js';
import {
  createDiplomacyWindow,
  type DiplomacyPanelRow,
  type DiplomacyWindowLayout,
  hitTestDiplomacyWindow,
  layoutDiplomacyWindow,
  resolveSelectedPlayer,
} from '../src/hud/tool-panel/diplomacy/index.js';
import { buildToolPanelLayout } from '../src/hud/tool-panel/layout.js';

const SCREEN = { width: 800, height: 600 };

function stubContext(): { ctx: PanelContext; texts: string[] } {
  const layout = buildToolPanelLayout(1);
  const texts: string[] = [];
  const ctx: PanelContext = {
    layout,
    scale: layout.scale,
    makeText: (text): TextRun => {
      texts.push(text);
      return { container: new Container(), width: 0, place: () => undefined, destroy: () => undefined };
    },
    bitmaps: { bg: undefined, button: undefined, buttonHilite: undefined, headline: undefined },
    uiString: (_table, _id, fallback) => fallback,
    screen: () => SCREEN,
  };
  return { ctx, texts };
}

const row = (player: number, over: Partial<DiplomacyPanelRow> = {}): DiplomacyPanelRow => ({
  player,
  colour: 0xff0000,
  towardYou: 'enemy',
  yourStance: 'enemy',
  ...over,
});

/** The layout the controller builds for `players`, from the same origin rule it uses. */
function expectedLayout(
  ctx: PanelContext,
  players: readonly number[],
  selected: number | null,
): DiplomacyWindowLayout {
  const anchor = ctx.layout.buttons.find((b) => b.id === 'diplomacy');
  if (anchor === undefined) throw new Error('no diplomacy button in the strip');
  return layoutDiplomacyWindow({
    originX: ctx.layout.width + WIN_PAD * ctx.scale,
    originY: anchor.placed.y,
    scale: ctx.scale,
    players,
    selected,
  });
}

const centreOf = (r: { x: number; y: number; w: number; h: number }): { x: number; y: number } => ({
  x: r.x + r.w / 2,
  y: r.y + r.h / 2,
});

describe('diplomacy window model', () => {
  it('wraps tabs into two columns and sizes the window to the grid', () => {
    const three = layoutDiplomacyWindow({
      originX: 0,
      originY: 0,
      scale: 1,
      players: [0, 1, 2],
      selected: 1,
    });
    expect(three.tabs.map((t) => t.player)).toEqual([0, 1, 2]);
    expect(three.tabs.map((t) => t.selected)).toEqual([false, true, false]);
    expect(three.tabs[0]?.rect.y).toBe(three.tabs[1]?.rect.y); // first grid row
    expect(three.tabs[2]?.rect.y).toBeGreaterThan(three.tabs[0]?.rect.y ?? 0); // wrapped
    const two = layoutDiplomacyWindow({ originX: 0, originY: 0, scale: 1, players: [0, 1], selected: 0 });
    expect(three.window.h).toBeGreaterThan(two.window.h); // an extra tab row grows the window
  });

  it('lays out one placeholder line when no player was discovered', () => {
    const empty = layoutDiplomacyWindow({ originX: 0, originY: 0, scale: 1, players: [], selected: null });
    expect(empty.tabs).toEqual([]);
    expect(empty.bodyLines).toHaveLength(1);
  });

  it('resolves a vanished or unset selection to the first row', () => {
    const rows = [row(2), row(5)];
    expect(resolveSelectedPlayer(rows, null)).toBe(2);
    expect(resolveSelectedPlayer(rows, 5)).toBe(5);
    expect(resolveSelectedPlayer(rows, 9)).toBe(2);
    expect(resolveSelectedPlayer([], 9)).toBeNull();
  });

  it('hit-tests close over tabs over the window body', () => {
    const layout = layoutDiplomacyWindow({
      originX: 10,
      originY: 10,
      scale: 1,
      players: [0, 1],
      selected: 0,
    });
    const close = centreOf(layout.closeRect);
    expect(hitTestDiplomacyWindow(layout, close.x, close.y)).toEqual({ kind: 'close' });
    const tab = centreOf(layout.tabs[1]?.rect ?? layout.window);
    expect(hitTestDiplomacyWindow(layout, tab.x, tab.y)).toEqual({ kind: 'tab', player: 1 });
    const body = centreOf(layout.bodyLines[0] ?? layout.window);
    expect(hitTestDiplomacyWindow(layout, body.x, body.y)).toEqual({ kind: 'window' });
    expect(hitTestDiplomacyWindow(layout, layout.window.x - 2, layout.window.y - 2)).toBeNull();
  });
});

describe('diplomacy window controller', () => {
  it('opens with a tab per row and reads out both directions for the first player', () => {
    const { ctx, texts } = stubContext();
    const rows = [
      row(1, { name: 'Wikingowie', towardYou: 'friend', yourStance: 'neutral' }),
      row(3, { towardYou: 'enemy', yourStance: 'enemy' }),
    ];
    const window = createDiplomacyWindow({ ctx, container: new Container(), rows: () => rows });

    window.toggle();
    expect(window.isOpen()).toBe(true);
    expect(texts).toContain('Dyplomacja');
    expect(texts).toContain('Wikingowie'); // the named tab
    expect(texts).toContain('Gracz 3'); // the numbered fallback tab
    expect(texts).toContain('Stosunek do twojego plemienia jest');
    expect(texts).toContain('przyjazny'); // first row selected: their stance...
    expect(texts).toContain('neutralny'); // ...and yours
  });

  it('switches the readout on a tab click and closes on the close box', () => {
    const { ctx, texts } = stubContext();
    const rows = [
      row(1, { towardYou: 'friend', yourStance: 'friend' }),
      row(3, { towardYou: 'neutral', yourStance: 'enemy' }),
    ];
    const window = createDiplomacyWindow({ ctx, container: new Container(), rows: () => rows });
    window.toggle();
    const layout = expectedLayout(ctx, [1, 3], 1);

    texts.length = 0;
    const tab = centreOf(layout.tabs[1]?.rect ?? layout.window);
    expect(window.handleClick(tab.x, tab.y)).toBe(true);
    expect(texts).toContain('neutralny');
    expect(texts).toContain('wrogi');

    const replacement = createDiplomacyWindow({ ctx, container: new Container(), rows: () => rows });
    replacement.restore(window.state());
    texts.length = 0;
    replacement.toggle();
    expect(replacement.state()).toBe(3);
    expect(texts).toContain('wrogi');

    const close = centreOf(layout.closeRect);
    expect(window.handleClick(close.x, close.y)).toBe(true);
    expect(window.isOpen()).toBe(false);
    expect(window.claims(tab.x, tab.y)).toBe(false);
  });

  it('rebuilds on refresh only when the rows changed - a stance flip repaints, a quiet frame does not', () => {
    const { ctx, texts } = stubContext();
    let rows = [row(1, { towardYou: 'friend', yourStance: 'friend' })];
    const window = createDiplomacyWindow({ ctx, container: new Container(), rows: () => rows });
    window.toggle();

    texts.length = 0;
    window.refresh();
    expect(texts).toEqual([]); // same rows - no rebuild

    rows = [row(1, { towardYou: 'enemy', yourStance: 'friend' })];
    window.refresh();
    expect(texts).toContain('wrogi'); // the flip repainted the readout
  });

  it('shows a discovered-nobody placeholder and grows a tab when a player appears', () => {
    const { ctx, texts } = stubContext();
    let rows: DiplomacyPanelRow[] = [];
    const window = createDiplomacyWindow({ ctx, container: new Container(), rows: () => rows });
    window.toggle();
    expect(texts).toContain('Nie spotkano jeszcze innych plemion');

    rows = [row(4, { name: 'Sasi' })];
    window.refresh();
    expect(texts).toContain('Sasi');
  });
});
