import { describe, expect, it } from 'vitest';
import { TEAM_COLOR_STRENGTH_MAX } from '../../../src/catalog/player-color.js';
import { teamColour } from '../../../src/view/accessibility/team-colour.js';
import { defaultSettings, persistSettings } from '../../../src/view/settings/store.js';

const RED = 0xd0342c;

describe('teamColour', () => {
  it('shows the retail swatch by default and follows a saved strength change', () => {
    expect(teamColour(RED)).toBe(RED);
    persistSettings({ ...defaultSettings(), teamColorStrength: TEAM_COLOR_STRENGTH_MAX });
    expect(teamColour(RED)).not.toBe(RED);
    persistSettings(defaultSettings());
    expect(teamColour(RED)).toBe(RED);
  });
});
