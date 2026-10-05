import { describe, expect, it } from 'vitest';
import { sameSpeedBarLook } from '../src/hud/dom/system-bar.js';
import { formatMessage, messages } from '../src/i18n/index.js';
import { createShortfallLook, shortfallLook } from '../src/view/speed-shortfall.js';

describe('local speed shortfall on the speed bar', () => {
  it('presses the preset the game reaches and names both speeds to the tenth', () => {
    expect(shortfallLook(null, 3)).toBeNull();
    expect(shortfallLook(1.43, 3)).toEqual({
      kind: 'slowed',
      title: formatMessage(messages().hud.speedShortfall, { delivered: '×1,4', requested: '×3' }),
      pressed: 'normal',
    });
    expect(shortfallLook(2.2, 3)).toMatchObject({ pressed: 'fast' });
  });

  it('keeps one look per figure to the tenth, for a caller that asks every frame', () => {
    const look = createShortfallLook();
    const first = look(1.41, 3);
    expect(look(1.44, 3)).toBe(first);
    expect(look(1.46, 3)).not.toBe(first);
    expect(look(null, 3)).toBeNull();
  });

  it('tells looks apart by what the bar shows', () => {
    const slowed = shortfallLook(1.4, 3);
    expect(sameSpeedBarLook(slowed, shortfallLook(1.4, 3))).toBe(true);
    expect(sameSpeedBarLook(slowed, shortfallLook(2.4, 3))).toBe(false);
    expect(sameSpeedBarLook(slowed, null)).toBe(false);
    expect(sameSpeedBarLook(null, null)).toBe(true);
    expect(sameSpeedBarLook({ kind: 'held', title: 'a' }, { kind: 'held', title: 'a' })).toBe(true);
  });
});
