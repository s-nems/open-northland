// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { messages } from '../src/i18n/index.js';
import { mountResyncPlaque } from '../src/view/net/resync-plaque.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('resync plaque', () => {
  it('shows the resync heading with the current line, and leaves nothing behind', () => {
    const plaque = mountResyncPlaque('waiting');
    const root = document.querySelector('.boot-resync');
    expect(root?.getAttribute('role')).toBe('alert');
    expect(root?.querySelector('.boot-roster__heading')?.textContent).toBe(messages().net.resyncTitle);
    expect(root?.querySelector('.boot-resync__text')?.textContent).toBe('waiting');
    plaque.update('rebuilding');
    expect(root?.querySelector('.boot-resync__text')?.textContent).toBe('rebuilding');
    plaque.dispose();
    expect(document.querySelector('.boot-resync')).toBeNull();
  });
});
