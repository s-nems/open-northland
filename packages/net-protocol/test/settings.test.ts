import { type LobbySettings, sameLobbySettings } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';

const BASE: LobbySettings = {
  name: 'Zatoka',
  seed: 7,
  speed: 1,
  rules: { fog: null, progression: null, needs: null },
};

describe('lobby settings comparison', () => {
  it('tells apart settings that differ in any one field or rule', () => {
    const changed: readonly LobbySettings[] = [
      { ...BASE, name: 'Fjord' },
      { ...BASE, seed: 8 },
      { ...BASE, speed: 2 },
      { ...BASE, kickedSeatMode: 'ai' },
      { ...BASE, rules: { ...BASE.rules, fog: 1 } },
      { ...BASE, rules: { ...BASE.rules, progression: false } },
      { ...BASE, rules: { ...BASE.rules, needs: true } },
    ];
    for (const settings of changed) expect(sameLobbySettings(BASE, settings)).toBe(false);
    expect(sameLobbySettings(BASE, { ...BASE, rules: { ...BASE.rules } })).toBe(true);
  });
});
