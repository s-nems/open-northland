import { describe, expect, it } from 'vitest';
import { MENU_FOG_MODES, MENU_SPEEDS, targetSearch } from '../src/entries/menu/settings.js';
import { parseMapsIndex } from '../src/entries/menu.js';

/**
 * The menu's `/maps-index` narrowing (the JSON boundary between the dev-server middleware and the
 * map cards). Rendering itself is DOM work a human signs off in the browser; what is proven here is
 * the per-entry tolerance — a malformed sidecar field degrades that one card, never the list.
 */
describe('parseMapsIndex', () => {
  it('keeps well-formed entries with optional name/description and the minimap flag', () => {
    expect(
      parseMapsIndex([
        { id: 'blekiny_nurt', name: 'BŁĘKITNY NURT', description: 'Dolina Nilu', minimap: true },
        { id: 'bare_map', minimap: false },
      ]),
    ).toEqual([
      { id: 'blekiny_nurt', name: 'BŁĘKITNY NURT', description: 'Dolina Nilu', minimap: true },
      { id: 'bare_map', minimap: false },
    ]);
  });

  it('drops entries without a string id and ignores wrong-typed optional fields', () => {
    expect(
      parseMapsIndex([
        { id: '' },
        { name: 'no id' },
        'a-plain-string',
        null,
        { id: 'ok', name: 42, description: ['x'], minimap: 'yes' },
      ]),
    ).toEqual([{ id: 'ok', minimap: false }]);
  });

  it('yields an empty list for a non-array response', () => {
    expect(parseMapsIndex(undefined)).toEqual([]);
    expect(parseMapsIndex({ maps: [] })).toEqual([]);
    expect(parseMapsIndex('nope')).toEqual([]);
  });
});

describe('targetSearch', () => {
  it('carries only player-facing game settings into the selected entry', () => {
    const current = new URLSearchParams(
      'lang=eng&uiscale=1.75&speed=6&fog=recon&debug=geometry&zoom=2&sound=off&atlas=none&terrain=off&objects=off&pitch=44&pitchy=50',
    );

    expect(targetSearch('?scene=sandbox', current)).toBe(
      '?lang=eng&uiscale=1.75&speed=6&fog=recon&debug=geometry&scene=sandbox',
    );
  });

  it('offers slower and faster rates around the three in-game speeds', () => {
    expect(MENU_SPEEDS).toEqual(['0.25', '0.5', '1', '2', '3', '4', '6', '8']);
  });

  it('offers only the three player-facing fog modes', () => {
    expect(MENU_FOG_MODES).toEqual(['off', 'reveal', 'recon']);
  });

  it('starts worlds in classic fog when no mode was selected', () => {
    expect(targetSearch('?scene=sandbox', new URLSearchParams('lang=pol'))).toBe(
      '?lang=pol&scene=sandbox&fog=reveal',
    );
  });

  it('does not add a fog mode to tools', () => {
    expect(targetSearch('?icons', new URLSearchParams('lang=pol'))).toBe('?lang=pol&icons=');
  });
});
