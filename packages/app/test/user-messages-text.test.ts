import { describe, expect, it } from 'vitest';
import type { UiString } from '../src/content/gui-gfx.js';
import {
  composeMessageText,
  MESSAGE_STRING_ID,
  type MessageTextDeps,
  userMessageTypeName,
} from '../src/hud/tool-panel/messages/text.js';
import { USER_MESSAGE_TYPE, type UserMessageTypeName } from '../src/hud/tool-panel/messages/types.js';

/** Synthetic stand-ins for the `messages` rows the composer reads; the shapes matter, not the words. */
const ROWS: Readonly<Record<number, string>> = {
  10: 'row10',
  27: 'row27 %s tail',
  28: 'row28',
  50: 'row50',
  58: 'row58',
  60: 'row60',
  90: '- row90',
  120: 'row120',
  121: 'row121-unknown',
};

const decoded: UiString = (table, id, fallback) => (table === 'messages' ? (ROWS[id] ?? fallback) : fallback);
const deps: MessageTextDeps = { uiString: decoded, fallbackRow: (id) => `<${id}>` };

const compose = (
  type: (typeof USER_MESSAGE_TYPE)[UserMessageTypeName],
  subjectName: string | null,
  jobLabel: string | null = null,
  goodName: string | null = null,
  stanceName: string | null = null,
) => composeMessageText(type, { subjectName, jobLabel, goodName, stanceName }, deps);

describe('user message text', () => {
  it('maps every type to a messages row', () => {
    for (const name of Object.keys(USER_MESSAGE_TYPE) as UserMessageTypeName[]) {
      expect(MESSAGE_STRING_ID[name]).toBeGreaterThan(0);
      expect(userMessageTypeName(USER_MESSAGE_TYPE[name])).toBe(name);
    }
  });

  it('leads with the settler and its trade in parentheses', () => {
    expect(compose(USER_MESSAGE_TYPE.hungry, 'Bjorn Olafson', 'Budowniczy')).toBe(
      'Bjorn Olafson (Budowniczy) row10',
    );
    expect(compose(USER_MESSAGE_TYPE.wasBorn, 'Astrid')).toBe('Astrid row50');
  });

  it('names the building before its dashed row', () => {
    expect(compose(USER_MESSAGE_TYPE.houseFinished, 'Dom')).toBe('Dom - row90');
    expect(compose(USER_MESSAGE_TYPE.houseFinished, null)).toBe('- row90');
  });

  it('reports an unnamed death through the unknown-hero row', () => {
    expect(compose(USER_MESSAGE_TYPE.humanDied, 'Leif')).toBe('Leif row120');
    expect(compose(USER_MESSAGE_TYPE.humanDied, null)).toBe('row121-unknown');
  });

  it('substitutes the good into the stock-full row and appends the detail rows', () => {
    expect(compose(USER_MESSAGE_TYPE.stockFull, 'Leif', null, 'Drewno')).toBe('Leif row27 Drewno tail');
    expect(compose(USER_MESSAGE_TYPE.stockFull, 'Leif')).toBe('Leif row28');
    expect(compose(USER_MESSAGE_TYPE.backpackFull, 'Leif')).toBe('Leif row58 row60');
  });

  it('appends the stance to the rows about another seat, which end on a lead-in', () => {
    expect(compose(USER_MESSAGE_TYPE.playerSighted, 'Gracz 2', null, null, 'wrogi')).toBe(
      'Gracz 2 <131> wrogi',
    );
    expect(compose(USER_MESSAGE_TYPE.diplomacyChanged, 'Gracz 2', null, null, 'przyjazny')).toBe(
      'Gracz 2 <132> przyjazny',
    );
  });

  it('falls back to the catalog row when the decoded strings are absent', () => {
    const bare: MessageTextDeps = {
      uiString: (_t, _i, fallback) => fallback,
      fallbackRow: (id) => `<${id}>`,
    };
    expect(
      composeMessageText(
        USER_MESSAGE_TYPE.houseUpgraded,
        { subjectName: 'Dom', jobLabel: null, goodName: null, stanceName: null },
        bare,
      ),
    ).toBe('Dom <91>');
  });
});
