import { expect, it } from 'vitest';
import { otherWorldSearch } from '../src/view/runtime/save-load/other-world.js';

it('keeps the person civilization for an entry rebuilt from the world, and a recorded entry its own', () => {
  const current = new URLSearchParams('map=campaign&lang=pol&tribe=2');
  const bare = new URLSearchParams(otherWorldSearch({ mapId: 'campaign_sub', entry: null }, current) ?? '');
  expect(bare.get('tribe')).toBe('2');
  expect(bare.get('lang')).toBe('pol');
  const recorded = { mapId: 'campaign_sub', entry: '?map=campaign_sub&tribe=3' };
  expect(new URLSearchParams(otherWorldSearch(recorded, current) ?? '').get('tribe')).toBe('3');
  expect(otherWorldSearch({ mapId: null, entry: null }, current)).toBeNull();
});
