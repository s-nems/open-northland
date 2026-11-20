// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mapModeToggles } from '../../../../src/entries/main-menu/lobby-controls/mode.js';
import { type MapSelectItem, mapItem } from '../../../../src/entries/main-menu/map-select/model.js';
import { TINY_FINGERPRINT } from '../../../support/catalog-maps.js';

function item(id: string, mode?: { name: string; detail: string }): MapSelectItem {
  return mapItem(
    {
      id,
      name: { eng: id },
      fingerprint: TINY_FINGERPRINT,
      picture: false,
      minimap: false,
      ...(mode === undefined
        ? {}
        : { mode: { of: 'fortress', name: { eng: mode.name }, detail: { eng: mode.detail } } }),
    },
    'eng',
  );
}

const RAGNAROK = item('fortress_ragnarok', { name: 'Ragnarök', detail: 'Harder.' });
const SIEGE = item('fortress_siege', { name: 'Siege', detail: 'Longer.' });
const BASE = { ...item('fortress'), modes: [RAGNAROK, SIEGE] };

describe('mapModeToggles', () => {
  it('offers one switch per mode, off by default, at most one on, and reports each flip', () => {
    const changes: (string | null)[] = [];
    const rows = mapModeToggles(BASE, null, (next) => changes.push(next?.id ?? null));
    expect(rows.map((row) => [row.textContent, row.title])).toEqual([
      ['Ragnarök', 'Harder.'],
      ['Siege', 'Longer.'],
    ]);
    const [ragnarok, siege] = rows.map((row) => row.querySelector('button'));
    expect(ragnarok?.getAttribute('aria-checked')).toBe('false');
    ragnarok?.click();
    siege?.click();
    expect(ragnarok?.getAttribute('aria-checked')).toBe('false');
    expect(siege?.getAttribute('aria-checked')).toBe('true');
    siege?.click();
    expect(changes).toEqual([RAGNAROK.id, SIEGE.id, null]);
  });

  it('starts on the current mode and gives each row its detail as a tooltip', () => {
    const rows = mapModeToggles(BASE, SIEGE, () => undefined);
    expect(rows[1]?.querySelector('button')?.getAttribute('aria-checked')).toBe('true');
    expect(rows[0]?.title).toBe('Harder.');
  });

  it('shows nothing for a map without modes', () => {
    expect(mapModeToggles(item('valley'), null, () => undefined)).toEqual([]);
  });
});
