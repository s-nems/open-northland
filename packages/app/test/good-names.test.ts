import { describe, expect, it } from 'vitest';
import { resolveGoodNameMap } from '../src/content/good-names.js';
import { GOOD_GOLD, GOOD_WOOD } from '../src/game/sandbox/ids/index.js';
import { sandboxContent } from '../src/game/sandbox/index.js';

/**
 * Localized good names: the pure locale-resolution rule ({@link resolveGoodNameMap}) and its effect on the
 * shared sandbox content — supplying a `goodNames` map sets each good's display `name`, so the whole HUD
 * (warehouse rows, ground-pile tooltip, spawn palette) reads in-language from one source. Omitting it leaves
 * the golden-safe defaults (core goods name-less, extended goods English), which the other tests rely on.
 */
describe('resolveGoodNameMap (locale fallback)', () => {
  const tables = {
    pl: { wood: 'Drewno', fish: 'Ryba', gold: 'Złoto' },
    en: { wood: 'Wood', fish: 'Fish', gold: 'Gold' },
  };

  it('picks the requested locale, keyed by good STRING id', () => {
    const pl = resolveGoodNameMap(tables, 'pl');
    expect(pl.get('wood')).toBe('Drewno');
    expect(pl.get('gold')).toBe('Złoto');
  });

  it('names the synthetic plank (no game string table) in-language', () => {
    expect(resolveGoodNameMap(tables, 'pl').get('plank')).toBe('Kłoda');
    expect(resolveGoodNameMap(tables, 'en').get('plank')).toBe('Log');
  });

  it('uses the authored translation catalog when shipped tables are absent', () => {
    const map = resolveGoodNameMap({}, 'pl');
    expect(map.get('wood')).toBe('Drewno');
    expect(map.get('plank')).toBe('Kłoda');
    expect(resolveGoodNameMap({}, 'en').get('wood')).toBe('Wood');
  });
});

describe('sandboxContent goodNames override', () => {
  it('sets each good display name from the map (core + extended), keyed by id', () => {
    const goodNames = new Map<string, string>([
      ['wood', 'Drewno'],
      ['gold', 'Złoto'],
      ['meat', 'Mięso'],
    ]);
    const content = sandboxContent(undefined, { goodNames });
    const nameOf = (typeId: number) => content.goods.find((g) => g.typeId === typeId)?.name;
    expect(nameOf(GOOD_WOOD)).toBe('Drewno'); // a core good — name-less by default, now localized
    expect(nameOf(GOOD_GOLD)).toBe('Złoto');
    // An extended good resolves by its string id too.
    expect(content.goods.find((g) => g.id === 'meat')?.name).toBe('Mięso');
  });

  it('leaves core goods name-less and extended goods English when no map is supplied (golden-safe)', () => {
    const content = sandboxContent();
    expect(content.goods.find((g) => g.typeId === GOOD_WOOD)?.name).toBeUndefined();
    expect(content.goods.find((g) => g.id === 'meat')?.name).toBe('Meat');
  });
});
