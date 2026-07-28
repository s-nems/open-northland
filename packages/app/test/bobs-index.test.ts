import { describe, expect, it } from 'vitest';
import { parseBobsIndex } from '../src/entries/icons.js';

/**
 * The `?icons` gallery's `/bobs-index` narrowing. The payload type is shared with the node builder that
 * emits it, but a type is a compile-time link only: a host serving something else must degrade that one
 * row rather than hand the gallery an entry whose fields read `undefined`.
 */
describe('parseBobsIndex', () => {
  it('keeps well-formed rows, variant included when the stem carries one', () => {
    expect(
      parseBobsIndex([
        { stem: 'ls_gui_window.iconsleft', base: 'ls_gui_window', variant: 'iconsleft' },
        { stem: 'ls_goods', base: 'ls_goods', variant: '' },
      ]),
    ).toEqual([
      { stem: 'ls_gui_window.iconsleft', base: 'ls_gui_window', variant: 'iconsleft' },
      { stem: 'ls_goods', base: 'ls_goods', variant: '' },
    ]);
  });

  it('drops a row with a missing, empty or wrong-typed field, keeping the rest', () => {
    expect(
      parseBobsIndex([
        { stem: '', base: 'ls_goods', variant: '' },
        { stem: 'ls_goods', base: 'ls_goods' },
        { stem: 'ls_houses_viking', base: 7, variant: '' },
        'ls_goods',
        null,
        { stem: 'ls_goods', base: 'ls_goods', variant: '' },
      ]),
    ).toEqual([{ stem: 'ls_goods', base: 'ls_goods', variant: '' }]);
  });

  it('reads a non-array payload as no atlases at all', () => {
    expect(parseBobsIndex(null)).toEqual([]);
    expect(parseBobsIndex({ stems: [] })).toEqual([]);
  });
});
