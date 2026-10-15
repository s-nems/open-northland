import { expect, it } from 'vitest';
import { relaunchSearch } from '../src/view/runtime/save-load/relaunch.js';
import { targetSearch } from '../src/view/target-search.js';

it('takes the civilization from the save entry alone, never from the running page', () => {
  const current = new URLSearchParams('map=campaign&lang=pol&tribe=2');
  const launch = (entry: string): URLSearchParams =>
    new URLSearchParams(targetSearch(relaunchSearch({ mapId: 'campaign_sub', entry }) ?? '', current));
  expect(launch('?map=campaign_sub').get('tribe')).toBeNull();
  expect(launch('?map=campaign_sub').get('lang')).toBe('pol');
  expect(launch('?map=campaign_sub&tribe=3').get('tribe')).toBe('3');
});
