import { describe, expect, it } from 'vitest';
import {
  type ArticleBlock,
  articleLanguage,
  blockStrings,
  fillTokens,
  parseInline,
  tokensOf,
} from '../../../src/hud/knowledge/articles.js';
import { createKnowledgeBase } from '../../../src/hud/knowledge/base.js';
import { HUMAN_HITPOINTS } from '../../../src/hud/knowledge/combat.js';
import { factText } from '../../../src/hud/knowledge/facts.js';
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
    const text = '{{humanHitpoints}} i {{nope}}';
    expect(tokensOf(text)).toEqual(['humanHitpoints', 'nope']);
    expect(fillTokens(text, (name) => factText(name, base))).toBe(`${HUMAN_HITPOINTS} i {{nope}}`);
  });

  it('answers nothing for a name off the object prototype', () => {
    expect(factText('toString', base)).toBeUndefined();
  });
});

describe('articleLanguage', () => {
  it('falls back to a language that has text', () => {
    expect(articleLanguage('pol')).toBe('pol');
    expect(articleLanguage('ger')).toBe('pol');
  });
});

describe('blockStrings', () => {
  it('reaches every string of a table', () => {
    const block: ArticleBlock = { table: { head: ['a'], rows: [[1]], foot: 'c', filter: 'd' } };
    expect(blockStrings(block)).toEqual(['a', '1', 'c', 'd']);
  });
});
