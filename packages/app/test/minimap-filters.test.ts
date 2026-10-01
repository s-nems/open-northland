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
  it('start with the owned forces and works shown, the clutter hidden, and every owner in scope', () => {
    const shown = MINIMAP_LAYERS.filter((layer) => DEFAULT_MINIMAP_FILTERS.layers[layer]);
    expect(shown).toEqual(['civilians', 'soldiers', 'buildings', 'vehicles']);
    expect(allMinimapLayersShown(DEFAULT_MINIMAP_FILTERS)).toBe(false);
    expect(DEFAULT_MINIMAP_FILTERS.scope).toBe('everyone');
    expect(defaultSettings().minimapFilters).toEqual(DEFAULT_MINIMAP_FILTERS);
  });

  it('toggle one layer, or all of them at once', () => {
    const roads = toggleMinimapLayer(DEFAULT_MINIMAP_FILTERS, 'roads');
    expect(roads.layers.roads).toBe(true);
    expect(toggleMinimapLayer(roads, 'roads').layers.roads).toBe(false);
    expect(allMinimapLayersShown(roads)).toBe(false);
    const hidden = withAllMinimapLayers(roads, false);
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
      layers: { soldiers: false, people: false, animals: 'no' },
      scope: 'allies',
    });
    expect(parsed).toEqual({ ...toggleMinimapLayer(DEFAULT_MINIMAP_FILTERS, 'soldiers'), scope: 'everyone' });
    expect(parsed.layers).not.toHaveProperty('people');
  });
});
