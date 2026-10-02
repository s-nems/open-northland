import { describe, expect, it } from 'vitest';
import { DEFAULT_KEY_BINDINGS } from '../src/hud/keybindings.js';
import { messages } from '../src/i18n/index.js';
import { availableTips, drawTip, type LoadingTipId, tipSegments } from '../src/view/loading-tips.js';

const ALL = availableTips(DEFAULT_KEY_BINDINGS);

/** A seeded mulberry32 draw, so the deck tests are repeatable. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 2 ** 32;
  };
}

describe('loading tips', () => {
  it('words every tip in both locales with no placeholder left unfilled', () => {
    for (const locale of ['pol', 'eng'] as const) {
      expect(Object.keys(messages(locale).loadingTips.tips).sort()).toEqual([...ALL].sort());
      for (const id of ALL) {
        const text = tipSegments(id, DEFAULT_KEY_BINDINGS, locale)
          .map((segment) => ('text' in segment ? segment.text : `[${segment.keycap}]`))
          .join('');
        expect(text).not.toMatch(/\{[A-Za-z]+\}/);
      }
    }
  });

  it("shows the player's own binding as the keycap", () => {
    const keycaps = (id: LoadingTipId, bindings = DEFAULT_KEY_BINDINGS) =>
      tipSegments(id, bindings).flatMap((segment) => ('keycap' in segment ? [segment.keycap] : []));
    expect(keycaps('attackMove')).toEqual(['A']);
    expect(keycaps('attackMove', { ...DEFAULT_KEY_BINDINGS, attackMove: 'KeyK' })).toEqual(['K']);
    expect(keycaps('queueOrders')).toEqual(['Shift']);
    expect(keycaps('nextCivilian')).toEqual(['.']);
  });

  it('leaves out a tip whose key the player unbound', () => {
    const tips = availableTips({ ...DEFAULT_KEY_BINDINGS, upgradeBuilding: null });
    expect(tips).not.toContain('upgrade');
    expect(tips).toContain('queueOrders');
  });

  it('deals every tip once before any repeats, and never the same tip twice in a row', () => {
    const random = seeded(7);
    let deck: LoadingTipId[] = [];
    let last: LoadingTipId | null = null;
    for (let round = 0; round < 20; round++) {
      const dealt: LoadingTipId[] = [];
      for (let i = 0; i < ALL.length; i++) {
        const { tip, rest } = drawTip(deck, ALL, last, random);
        expect(tip).not.toBeNull();
        expect(tip).not.toBe(last);
        dealt.push(tip as LoadingTipId);
        deck = rest;
        last = tip;
      }
      expect([...dealt].sort()).toEqual([...ALL].sort());
    }
  });

  it('opens fresh decks in different orders', () => {
    const random = seeded(11);
    const openers = new Set<LoadingTipId | null>();
    for (let i = 0; i < 50; i++) openers.add(drawTip([], ALL, null, random).tip);
    expect(openers.size).toBeGreaterThan(ALL.length / 2);
  });

  it('drops a stored tip that is no longer available', () => {
    const { tip, rest } = drawTip(['upgrade', 'roads'], ['roads', 'buildRun'], null, seeded(1));
    expect(tip).toBe('roads');
    expect(rest).toEqual([]);
  });
});
