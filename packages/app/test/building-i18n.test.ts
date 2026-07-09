import { describe, expect, it } from 'vitest';
import { localizedBuildingName, untranslatedBuildingIds } from '../src/catalog/building-i18n.js';
import { VIKING_BUILDINGS } from '../src/catalog/buildings.js';

describe('building name localization', () => {
  it('has a Polish name for every catalog building (no drift)', () => {
    expect(untranslatedBuildingIds('pol')).toEqual([]);
  });

  it('returns the Polish name for `pol` and keeps the English fallback otherwise', () => {
    // A known building resolves to its authored Polish name under `pol` …
    expect(localizedBuildingName('barracks', 'Barracks', 'pol')).toBe('Koszary');
    // … and to the English catalog label under an unlocalized language or an unknown id.
    expect(localizedBuildingName('barracks', 'Barracks', 'eng')).toBe('Barracks');
    expect(localizedBuildingName('unknown_id', 'Fallback', 'pol')).toBe('Fallback');
  });

  it('the level-suffixed English labels map to `(poziom N)` Polish names', () => {
    const bakery = VIKING_BUILDINGS.find((b) => b.id === 'work_bakery_01');
    if (bakery === undefined) throw new Error('missing bakery in catalog');
    expect(localizedBuildingName(bakery.id, bakery.label, 'pol')).toBe('Piekarnia (poziom 1)');
  });
});
