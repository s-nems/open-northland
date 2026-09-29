import { describe, expect, it } from 'vitest';
import {
  GOOD_AMULET_CRITICAL_HIT,
  GOOD_AMULET_DEFENSE,
  GOOD_MEAD,
  GOOD_POTION_HEAL_SMALL,
  GOOD_SWORD_LONG,
} from '../src/game/sandbox/ids/index.js';
import { goodDef } from '../src/hud/details-panel/model/context.js';
import { goodEffectText } from '../src/hud/details-panel/model/good-effect.js';
import { currentLocale, setActiveLocale } from '../src/i18n/index.js';
import { sandboxCtx } from './support/sandbox.js';

describe('good effect line', () => {
  const effect = (goodType: number): string => goodEffectText(goodDef(sandboxCtx(), goodType)?.equip);

  it('says what a draught or an amulet does, and nothing for other goods', () => {
    const previous = currentLocale();
    try {
      setActiveLocale('pol');
      expect(effect(GOOD_POTION_HEAL_SMALL)).toBe('Leczy 40% zdrowia · Łyków: 2');
      expect(effect(GOOD_MEAD)).toBe('Zaspokaja 50% głodu · Usuwa 50% zmęczenia · Łyków: 2');
      expect(effect(GOOD_AMULET_DEFENSE)).toBe('-50% otrzymanych obrażeń · Nie zużywa się');
      expect(effect(GOOD_AMULET_CRITICAL_HIT)).toBe('20% szans na cios ×2 · Nie zużywa się');
      expect(effect(GOOD_SWORD_LONG)).toBe('');
    } finally {
      setActiveLocale(previous);
    }
  });
});
