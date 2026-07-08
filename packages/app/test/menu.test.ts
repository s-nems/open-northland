import { describe, expect, it } from 'vitest';
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
