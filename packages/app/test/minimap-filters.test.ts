import { describe, expect, it } from 'vitest';
import {
  allMinimapLayersShown,
  DEFAULT_MINIMAP_FILTERS,
  MINIMAP_LAYERS,
  parseMinimapFilters,
  toggleMinimapLayer,
  withAllMinimapLayers,
} from '../src/hud/minimap/filters.js';
import { defaultSettings, parseStoredSettings } from '../src/view/settings-store.js';

describe('minimap filters', () => {
  it('start with every layer shown and every owner in scope', () => {
    expect(MINIMAP_LAYERS.every((layer) => DEFAULT_MINIMAP_FILTERS.layers[layer])).toBe(true);
    expect(DEFAULT_MINIMAP_FILTERS.scope).toBe('everyone');
    expect(defaultSettings().minimapFilters).toEqual(DEFAULT_MINIMAP_FILTERS);
  });

  it('toggle one layer, or all of them at once', () => {
    const noRoads = toggleMinimapLayer(DEFAULT_MINIMAP_FILTERS, 'roads');
    expect(noRoads.layers.roads).toBe(false);
    expect(allMinimapLayersShown(noRoads)).toBe(false);
    const hidden = withAllMinimapLayers(noRoads, false);
    expect(MINIMAP_LAYERS.some((layer) => hidden.layers[layer])).toBe(false);
    expect(allMinimapLayersShown(withAllMinimapLayers(hidden, true))).toBe(true);
  });

  it('survive a reload through the stored settings', () => {
    const chosen = { ...toggleMinimapLayer(DEFAULT_MINIMAP_FILTERS, 'soldiers'), scope: 'hostile' as const };
    const stored = JSON.stringify({ ...defaultSettings(), minimapFilters: chosen });
    expect(parseStoredSettings(stored).minimapFilters).toEqual(chosen);
  });

  it('keep the default for a missing or deformed field and drop unknown layers', () => {
    expect(parseStoredSettings(null).minimapFilters).toEqual(DEFAULT_MINIMAP_FILTERS);
    expect(parseMinimapFilters('roads')).toEqual(DEFAULT_MINIMAP_FILTERS);
    const parsed = parseMinimapFilters({
      layers: { roads: false, people: false, animals: 'no' },
      scope: 'allies',
    });
    expect(parsed).toEqual({ ...toggleMinimapLayer(DEFAULT_MINIMAP_FILTERS, 'roads'), scope: 'everyone' });
    expect(parsed.layers).not.toHaveProperty('people');
  });
});
