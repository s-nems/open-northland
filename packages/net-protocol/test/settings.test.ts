import { NO_RULE_OVERRIDES } from '@open-northland/lockstep';
import { type LobbySettings, sameLobbySettings } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';

const BASE: LobbySettings = {
  name: 'Zatoka',
  seed: 7,
  speed: 1,
  rules: NO_RULE_OVERRIDES,
};

describe('lobby settings comparison', () => {
  it('tells apart settings that differ in any one field or rule', () => {
    const changed: readonly LobbySettings[] = [
      { ...BASE, name: 'Fjord' },
      { ...BASE, seed: 8 },
      { ...BASE, speed: 2 },
      { ...BASE, kickedSeatMode: 'computer' },
      { ...BASE, rules: { ...BASE.rules, fog: 1 } },
      { ...BASE, rules: { ...BASE.rules, progression: false } },
      { ...BASE, rules: { ...BASE.rules, needs: true } },
      { ...BASE, rules: { ...BASE.rules, weather: 'winter' } },
    ];
    for (const settings of changed) expect(sameLobbySettings(BASE, settings)).toBe(false);
    expect(sameLobbySettings(BASE, { ...BASE, rules: { ...BASE.rules } })).toBe(true);
  });
});
