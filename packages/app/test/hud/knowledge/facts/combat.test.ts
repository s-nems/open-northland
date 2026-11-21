import { WeaponType } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { createKnowledgeBase } from '../../../../src/hud/knowledge/base.js';
import { factText } from '../../../../src/hud/knowledge/facts/index.js';
import { knowledgeContent, VIKING } from '../../../support/knowledge-content.js';

const SHORT_SWORD_TYPE = 7;
const BLOCK_PCT = 30;
const BLOCK_SOUND = 80;

describe('shield facts', () => {
  it('read the share of arrows the Viking short sword stops off its row', () => {
    const shortSword = WeaponType.parse({
      typeId: SHORT_SWORD_TYPE,
      id: 'short_sword',
      tribeType: VIKING,
      damage: {},
      arrowBlock: { chancePct: BLOCK_PCT, soundType: BLOCK_SOUND },
    });
    const content = knowledgeContent();
    const base = createKnowledgeBase({ ...content, weapons: [...content.weapons, shortSword] });
    expect(factText('combat.shieldPct', base)).toBe(String(BLOCK_PCT));
  });
});
