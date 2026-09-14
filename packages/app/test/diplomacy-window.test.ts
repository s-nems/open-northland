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
  type TributeCardSpec,
  type TributePanelRow,
} from '../src/hud/tool-panel/diplomacy/index.js';
import { fitDiplomacyWindow } from '../src/hud/tool-panel/diplomacy/viewport.js';
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
    makeParagraph: (text) => {
      texts.push(text);
      return {
        container: new Container(),
        width: 0,
        height: 0,
        place: () => undefined,
        destroy: () => undefined,
      };
    },
    bitmaps: { bg: undefined, button: undefined, buttonHilite: undefined, headline: undefined },
    uiString: (_table, _id, fallback) => fallback,
    screen: () => SCREEN,
    atScale: (scale) => ({ ...ctx, scale }),
  };
  return { ctx, texts };
}

const row = (player: number, over: Partial<DiplomacyPanelRow> = {}): DiplomacyPanelRow => ({
  player,
  colour: 0xff0000,
  towardYou: 'enemy',
  yourStance: 'enemy',
  tributes: [],
  ...over,
});

const tribute = (slot: number, payable: boolean, text?: string): TributePanelRow => ({
  slot,
  ...(text !== undefined ? { text } : {}),
  demands: [{ label: 'Drewno', amount: 6, onHand: 8 }],
  payable,
});

/** A one-demand card with a description one line high. */
const card = (slot: number, payable: boolean, lines = 1): TributeCardSpec => ({
  slot,
  payable,
  descriptionH: 12,
  lines,
});

/** The layout the controller builds for `players`, from the same origin rule it uses. */
function expectedLayout(
  ctx: PanelContext,
  players: readonly number[],
  selected: number | null,
  tributes: readonly TributeCardSpec[] = [],
): DiplomacyWindowLayout {
  const anchor = ctx.layout.buttons.find((b) => b.id === 'diplomacy');
  if (anchor === undefined) throw new Error('no diplomacy button in the strip');
  return layoutDiplomacyWindow({
    originX: ctx.layout.width + WIN_PAD * ctx.scale,
    originY: anchor.placed.y,
    scale: ctx.scale,
    players,
    selected,
    tributes,
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
      tributes: [],
    });
    expect(three.tabs.map((t) => t.player)).toEqual([0, 1, 2]);
    expect(three.tabs.map((t) => t.selected)).toEqual([false, true, false]);
    expect(three.tabs[0]?.rect.y).toBe(three.tabs[1]?.rect.y); // first grid row
    expect(three.tabs[2]?.rect.y).toBeGreaterThan(three.tabs[0]?.rect.y ?? 0); // wrapped
    const two = layoutDiplomacyWindow({
      originX: 0,
      originY: 0,
      scale: 1,
      players: [0, 1],
      selected: 0,
      tributes: [],
    });
    expect(three.window.h).toBeGreaterThan(two.window.h); // an extra tab row grows the window
  });

  it('lays out one placeholder line when no player was discovered', () => {
    const empty = layoutDiplomacyWindow({
      originX: 0,
      originY: 0,
      scale: 1,
      players: [],
      selected: null,
      tributes: [],
    });
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
      tributes: [],
    });
    const close = centreOf(layout.closeRect);
    expect(hitTestDiplomacyWindow(layout, close.x, close.y)).toEqual({ kind: 'close' });
    const tab = centreOf(layout.tabs[1]?.rect ?? layout.window);
    expect(hitTestDiplomacyWindow(layout, tab.x, tab.y)).toEqual({ kind: 'tab', player: 1 });
    const body = centreOf(layout.bodyLines[0] ?? layout.window);
    expect(hitTestDiplomacyWindow(layout, body.x, body.y)).toEqual({ kind: 'window' });
    expect(hitTestDiplomacyWindow(layout, layout.window.x - 2, layout.window.y - 2)).toBeNull();
  });

  it('stacks a card per tribute under the readout, each with a pay button inside it', () => {
    const bare = layoutDiplomacyWindow({
      originX: 0,
      originY: 0,
      scale: 1,
      players: [1],
      selected: 1,
      tributes: [],
    });
    const owing = layoutDiplomacyWindow({
      originX: 0,
      originY: 0,
      scale: 1,
      players: [1],
      selected: 1,
      tributes: [card(4, true), card(7, false, 3)],
    });
    expect(owing.window.h).toBeGreaterThan(bare.window.h);
    expect(owing.tributes.map((t) => t.slot)).toEqual([4, 7]);
    const [first, second] = owing.tributes;
    if (first === undefined || second === undefined) throw new Error('two cards expected');
    const lastLine = owing.bodyLines[owing.bodyLines.length - 1];
    expect(first.card.y).toBe((lastLine?.y ?? 0) + (lastLine?.h ?? 0));
    expect(second.card.y).toBe(first.card.y + first.card.h);
    expect(second.card.h).toBeGreaterThan(first.card.h); // three lines under the description
    expect(second.lines).toHaveLength(3);
    expect(first.text.y).toBeLessThan(first.lines[0]?.y ?? 0);
    expect(first.pay.x).toBeGreaterThan(first.card.x);
    expect(first.pay.x + first.pay.w).toBeLessThanOrEqual(first.card.x + first.card.w);
    expect(first.pay.y).toBeGreaterThan(first.card.y);
    expect(first.pay.y + first.pay.h).toBeLessThanOrEqual(first.card.y + first.card.h);
  });

  it('hit-tests a live pay button and treats a dead one as window background', () => {
    const layout = layoutDiplomacyWindow({
      originX: 0,
      originY: 0,
      scale: 1,
      players: [1],
      selected: 1,
      tributes: [card(4, true), card(7, false)],
    });
    const [live, dead] = layout.tributes;
    if (live === undefined || dead === undefined) throw new Error('two cards expected');
    const onLive = centreOf(live.pay);
    expect(hitTestDiplomacyWindow(layout, onLive.x, onLive.y)).toEqual({ kind: 'pay', slot: 4 });
    const onDead = centreOf(dead.pay);
    expect(hitTestDiplomacyWindow(layout, onDead.x, onDead.y)).toEqual({ kind: 'window' });
    const onCard = { x: live.card.x + 4, y: live.card.y + 4 };
    expect(hitTestDiplomacyWindow(layout, onCard.x, onCard.y)).toEqual({ kind: 'window' });
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

  it("lists the selected player's tributes with their demands and pays on a live button only", () => {
    const { ctx, texts } = stubContext();
    let rows = [
      row(1, { tributes: [tribute(4, true, 'Drewno dla sąsiada'), tribute(7, false)] }),
      row(3, { tributes: [tribute(9, true)] }),
    ];
    const paid: number[] = [];
    const window = createDiplomacyWindow({
      ctx,
      container: new Container(),
      rows: () => rows,
      onPayTribute: (slot) => paid.push(slot),
    });
    window.toggle();
    expect(texts).toContain('Drewno dla sąsiada');
    expect(texts).toContain('Trybut 7'); // the unworded slot's fallback
    expect(texts).toContain('6 Drewno (8 w składach)');
    expect(texts.filter((t) => t === 'Zapłać')).toHaveLength(2);
    expect(texts).not.toContain('Trybut 9'); // the other player's tribute waits behind its tab

    // The stub measures every description at no height, so the controller's cards are the specs below.
    const layout = expectedLayout(ctx, [1, 3], 1, [
      { slot: 4, payable: true, descriptionH: 0, lines: 1 },
      { slot: 7, payable: false, descriptionH: 0, lines: 1 },
    ]);
    const [live, dead] = layout.tributes;
    if (live === undefined || dead === undefined) throw new Error('two cards expected');
    const onDead = centreOf(dead.pay);
    expect(window.handleClick(onDead.x, onDead.y)).toBe(true);
    expect(paid).toEqual([]);
    const onLive = centreOf(live.pay);
    expect(window.handleClick(onLive.x, onLive.y)).toBe(true);
    expect(paid).toEqual([4]);

    // The sim applied the payment: the card leaves on the next refresh.
    rows = [row(1, { tributes: [tribute(7, false)] }), row(3, { tributes: [tribute(9, true)] })];
    texts.length = 0;
    window.refresh();
    expect(texts).not.toContain('Drewno dla sąsiada');
    expect(texts).toContain('Trybut 7');
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

it('allows scrolling to and paying a tribute beyond the initial viewport', () => {
  const { ctx } = stubContext();
  const paid: number[] = [];
  const rows = [row(1, { tributes: Array.from({ length: 20 }, (_, slot) => tribute(slot, true)) })];
  const window = createDiplomacyWindow({
    ctx,
    container: new Container(),
    rows: () => rows,
    onPayTribute: (slot) => paid.push(slot),
  });
  window.toggle();
  for (let i = 0; i < 40; i++) window.handleWheel(200, 300, 100);
  const raw = layoutDiplomacyWindow({
    originX: ctx.layout.width + WIN_PAD * ctx.scale,
    originY: 151,
    scale: 1,
    players: [1],
    selected: 1,
    tributes: Array.from({ length: 20 }, (_, slot) => ({ slot, payable: true, descriptionH: 0, lines: 1 })),
  });
  const last = fitDiplomacyWindow(raw, SCREEN, null, Infinity).tributes.at(-1);
  expect(last).toBeDefined();
  if (last === undefined) return;
  window.handleClick(last.pay.x + last.pay.w / 2, last.pay.y + last.pay.h / 2);
  expect(paid).toEqual([19]);
});
