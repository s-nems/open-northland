// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mountHudDomRoot } from '../../../src/hud/dom/root.js';

describe('HUD DOM root', () => {
  it('marks the body as a game while mounted, so the menu keeps its text selectable', () => {
    const root = mountHudDomRoot(1);
    expect(document.body.classList.contains('on-game')).toBe(true);
    root.dispose();
    expect(document.body.classList.contains('on-game')).toBe(false);
  });
});
