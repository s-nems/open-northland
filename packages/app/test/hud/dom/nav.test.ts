// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createHudNav } from '../../../src/hud/dom/nav.js';
import { TIP_ATTRIBUTE } from '../../../src/hud/dom/parts/dom.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('navigation beam', () => {
  it("an entry's tip names its current key after the label, and the label alone while unbound", () => {
    const plane = document.createElement('div');
    const nav = createHudNav(plane, 'Beam', [{ id: 'build', label: 'Build', art: '' }], () => {});
    const button = plane.querySelector('button');
    nav.setKey('build', 'B');
    expect(button?.getAttribute(TIP_ATTRIBUTE)).toBe('Build · B');
    nav.setKey('build', 'Shift + K');
    expect(button?.getAttribute(TIP_ATTRIBUTE)).toBe('Build · Shift + K');
    nav.setKey('build', null);
    expect(button?.getAttribute(TIP_ATTRIBUTE)).toBe('Build');
    nav.dispose();
  });
});
