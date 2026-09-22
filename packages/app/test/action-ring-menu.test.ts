import { describe, expect, it } from 'vitest';
import { guiFrameIndex } from '../src/content/gui-atlas-map.js';
import {
  ACTION_COMMANDS,
  type ActionCommandId,
  actionRingMenu,
  BOTTOM_ARM,
  INNER_LEFT_ARM,
  LEFT_ARM,
  RIGHT_ARM,
  TOP_ARM,
} from '../src/hud/action-ring/index.js';
import { en } from '../src/i18n/en.js';
import { pl } from '../src/i18n/pl.js';

/**
 * The ring's content table against the original's action rows as observed in the running game: which
 * arm each order sits on and the order along the arm. A row here is the drawn order, left to right for
 * the two rows and top to bottom for the three columns.
 */
const ids = (arm: number): ActionCommandId[] => ACTION_COMMANDS.filter((c) => c.arm === arm).map((c) => c.id);

describe('action-ring command table', () => {
  it('draws the family orders, then the needs, then the walk order along the bottom row', () => {
    expect(ids(BOTTOM_ARM)).toEqual(['haveGirl', 'haveBoy', 'marry', 'pray', 'talk', 'sleep', 'eat', 'goTo']);
  });

  it('draws the profession change leftmost on the top row, the scout orders rightmost', () => {
    expect(ids(TOP_ARM)).toEqual([
      'changeProfession',
      'changeEquipment',
      'assignWorkArea',
      'showWorkArea',
      'erectSignpost',
      'explore',
    ]);
  });

  it('draws the place assignments down the right column, site first and home last', () => {
    expect(ids(RIGHT_ARM)).toEqual([
      'removeBuildingSite',
      'assignBuildingSite',
      'removeLearningPlace',
      'assignLearningPlace',
      'removeWorkPlace',
      'assignWorkPlace',
      'assignVehicle',
      'removeHome',
      'assignHome',
    ]);
  });

  it('draws the attack targets down the left column and the modes down the inner column', () => {
    expect(ids(LEFT_ARM)).toEqual([
      'attackInhabitants',
      'attackBuilding',
      'attackAnimal',
      'attackVehicle',
      'attackPosition',
    ]);
    expect(ids(INNER_LEFT_ARM)).toEqual([
      'attackMode',
      'defenceMode',
      'ignorantMode',
      'allowRegeneration',
      'prohibitRegeneration',
    ]);
  });

  it('keeps the orders that name one settler out of a group', () => {
    const single = ACTION_COMMANDS.filter((c) => !c.multi).map((c) => c.id);
    expect(single).toContain('goTo');
    expect(single).toContain('explore');
    expect(single).not.toContain('assignHome');
    expect(single).not.toContain('marry');
    expect(single).not.toContain('attackMode');
  });

  it('binds every order to a real sheet frame and a tooltip in both catalogs', () => {
    for (const c of ACTION_COMMANDS) {
      expect(() => guiFrameIndex(c.icon), c.id).not.toThrow();
      expect(en.actionRing[c.id], `en ${c.id}`).toBeTypeOf('string');
      expect(pl.actionRing[c.id], `pl ${c.id}`).toBeTypeOf('string');
    }
    expect(new Set(ACTION_COMMANDS.map((c) => c.id)).size).toBe(ACTION_COMMANDS.length);
  });
});

describe('actionRingMenu', () => {
  it('keeps table order within an arm and drops arms nothing allows', () => {
    const menu = actionRingMenu(new Set(['goTo', 'haveGirl', 'attackPosition', 'attackInhabitants']));
    expect(menu.map((g) => g.arm)).toEqual([BOTTOM_ARM, LEFT_ARM]);
    expect(menu.map((g) => g.commands.map((c) => c.id))).toEqual([
      ['haveGirl', 'goTo'],
      ['attackInhabitants', 'attackPosition'],
    ]);
  });

  it('draws nothing for an empty allowance', () => {
    expect(actionRingMenu(new Set())).toEqual([]);
  });
});
