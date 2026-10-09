import { describe, expect, it } from 'vitest';
import { uiStringLookup } from '../src/content/gui-gfx.js';
import { actionLabel } from '../src/hud/action-ring/labels.js';
import { messages } from '../src/i18n/index.js';

const lookup = uiStringLookup({
  misclogic: {
    '1': 'fixture destination',
    '19': 'fixture trade',
    '36': 'fixture sign',
    '39': 'fixture stance',
  },
});

describe('action labels from content', () => {
  it('reads the selected action row from the loaded table', () => {
    expect(actionLabel('goTo', lookup, 'eng')).toBe('fixture destination');
    expect(actionLabel('changeProfession', lookup, 'pol')).toBe('fixture trade');
  });

  it('reads the signpost and defence rows from content, Polish included', () => {
    expect(actionLabel('erectSignpost', lookup, 'pol')).toBe('fixture sign');
    expect(actionLabel('defenceMode', lookup, 'pol')).toBe('fixture stance');
  });

  it('uses project wording when a row or the whole table is missing', () => {
    expect(actionLabel('assignHome', lookup, 'eng')).toBe('Assign Home');
    expect(actionLabel('assignHome', uiStringLookup(null), 'pol')).toBe('Wybierz dom');
    expect(messages('eng').actionRing.goTo).toBe('Go To');
  });
});
