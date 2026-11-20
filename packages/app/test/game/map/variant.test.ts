import { MAP_VARIANTS } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  chosenMapVariantParam,
  oreYieldAcrossVariants,
  sessionOreYield,
  withVariantOreYield,
} from '../../../src/game/map/variant.js';
import { mapSession } from '../../../src/game/match/session-url.js';

const RAGNAROK_SEARCH = new URLSearchParams({ map: 'specjalna_forteca', variant: 'ragnarok' });

describe('chosenMapVariantParam', () => {
  it('takes the variant the search names on a dev server', () => {
    expect(chosenMapVariantParam(RAGNAROK_SEARCH, 'specjalna_forteca', true)).toBe('ragnarok');
  });

  it('ignores the search outside a dev server', () => {
    expect(chosenMapVariantParam(RAGNAROK_SEARCH, 'specjalna_forteca', false)).toBeNull();
  });
});

describe('a variant ore richness', () => {
  it('is a factor a session carries for every committed variant', () => {
    for (const { mapId, kind } of MAP_VARIANTS) {
      expect(() => sessionOreYield({ kind: 'map', mapId, variant: kind })).not.toThrow();
    }
  });

  it('starts a room on Ragnarök at x3 unless the launch names a richness', () => {
    const ragnarok = { kind: 'map', mapId: 'specjalna_forteca', variant: 'ragnarok' } as const;
    const plain = mapSession(new URLSearchParams('map=specjalna_forteca'), []).rules;
    const chosen = mapSession(new URLSearchParams('map=specjalna_forteca&oreyield=5'), []).rules;
    expect(withVariantOreYield(plain, ragnarok).oreYield).toBe(3);
    expect(withVariantOreYield(chosen, ragnarok).oreYield).toBe(5);
    expect(withVariantOreYield(plain, { kind: 'map', mapId: 'specjalna_forteca' }).oreYield).toBeNull();
  });

  it("gives the player's own choice back when Ragnarök is turned off", () => {
    const on = oreYieldAcrossVariants('specjalna_forteca', null, 'ragnarok', { oreYield: 5, own: null });
    expect(on).toEqual({ oreYield: 3, own: 5 });
    expect(oreYieldAcrossVariants('specjalna_forteca', 'ragnarok', null, on)).toEqual({
      oreYield: 5,
      own: 5,
    });
    const moved = { oreYield: 2, own: 5 } as const;
    expect(oreYieldAcrossVariants('specjalna_forteca', 'ragnarok', null, moved).oreYield).toBe(2);
  });
});
