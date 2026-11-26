import { describe, expect, it } from 'vitest';
import { localizedLobbySlotTitle } from '../../../../src/entries/main-menu/lobby/local-seats.js';

describe('localizedLobbySlotTitle', () => {
  it('translates the language actually used by a map slot name', () => {
    expect(
      localizedLobbySlotTitle(
        { pol: 'Freie Siedlung' },
        'ger',
        'Spieler 1',
        ({ text, lang }) => `${text} [${lang}]`,
      ),
    ).toBe('Freie Siedlung [pol]');
  });

  it('keeps a slot name already authored in the selected language', () => {
    expect(
      localizedLobbySlotTitle({ ger: 'Freie Siedlung' }, 'ger', 'Spieler 1', ({ text, lang }) =>
        lang === null ? text : `translated: ${text}`,
      ),
    ).toBe('Freie Siedlung');
  });

  it('uses the normal slot fallback when the map has no name in any language', () => {
    expect(localizedLobbySlotTitle(undefined, 'ger', 'Spieler 1', ({ text }) => text)).toBe('Spieler 1');
  });
});
