import { describe, expect, it } from 'vitest';
import { LOCALE_CODES, messages } from '../../src/i18n/index.js';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

/** A building the catalogs miss is titled by its raw content id in every panel and note that names it. */
describe.runIf(hasRealIr())('building names against real content', () => {
  it('every extracted building has a name in each shipped locale', async () => {
    const { real } = await loadContentUnderTest();
    for (const locale of LOCALE_CODES) {
      const names: Readonly<Record<string, string | undefined>> = messages(locale).building;
      const unnamed = real.buildings.map((b) => b.id).filter((id) => names[id] === undefined);
      expect(unnamed, locale).toEqual([]);
    }
  });
});
