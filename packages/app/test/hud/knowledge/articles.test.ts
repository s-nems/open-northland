import { describe, expect, it } from 'vitest';
import {
  type ArticleBlock,
  blockStrings,
  fillTokens,
  parseInline,
  tokensOf,
} from '../../../src/hud/knowledge/articles.js';
import { createKnowledgeBase } from '../../../src/hud/knowledge/base.js';
import { HUMAN_HITPOINTS } from '../../../src/hud/knowledge/combat.js';
import { FACTS, factText } from '../../../src/hud/knowledge/facts.js';
import { knowledgeContent } from '../../support/knowledge-content.js';

describe('parseInline', () => {
  it('splits text around links', () => {
    expect(parseInline('Daj [[good:wood|Drewna]] i [[article:fog|mgłę]].')).toEqual([
      { text: 'Daj ' },
      { kind: 'good', id: 'wood', label: 'Drewna' },
      { text: ' i ' },
      { kind: 'article', id: 'fog', label: 'mgłę' },
      { text: '.' },
    ]);
  });

  it('leaves an unknown link kind as text', () => {
    expect(parseInline('[[spell:x|Y]]')).toEqual([{ text: '[[spell:x|Y]]' }]);
  });
});

describe('tokens', () => {
  const base = createKnowledgeBase(knowledgeContent());

  it('fills a known fact and keeps an unknown name visible', () => {
    const text = '{{health.human}} i {{nope}}';
    expect(tokensOf(text)).toEqual(['health.human', 'nope']);
    expect(fillTokens(text, (name) => factText(name, base))).toBe(`${HUMAN_HITPOINTS} i {{nope}}`);
  });

  it('answers nothing for a name off the object prototype', () => {
    expect(factText('toString', base)).toBeUndefined();
  });

  it('writes a fact with the decimals of the language', () => {
    expect(factText('step.land', base)).toBe('0,50');
    expect(factText('step.landBrief', base)).toBe('0,5');
  });

  it('leaves a fact visible when the content lacks its row', () => {
    const empty = createKnowledgeBase({ ...knowledgeContent(), goods: [] });
    const text = '{{draught.smallUses}}';
    expect(fillTokens(text, (name) => factText(name, empty))).toBe(text);
  });

  it('reads every fact over thin content without throwing', () => {
    for (const name of Object.keys(FACTS)) expect(() => factText(name, base)).not.toThrow();
  });
});

describe('blockStrings', () => {
  it('reaches every string of a table', () => {
    const block: ArticleBlock = { table: { head: ['a'], rows: [[1]], foot: 'c', filter: 'd' } };
    expect(blockStrings(block)).toEqual(['a', '1', 'c', 'd']);
  });
});
