import { describe, expect, it } from 'vitest';
import { createKnowledgeBase } from '../../../src/hud/knowledge/base.js';
import { entrySearchItems, foldSearchText, searchItems } from '../../../src/hud/knowledge/search.js';
import { knowledgeContent } from '../../support/knowledge-content.js';

const items = [
  { name: 'Żelazo', target: 1 },
  { name: 'Długi Miecz', target: 2 },
  { name: 'Krótki Miecz', target: 3 },
];

describe('knowledge search', () => {
  it('folds case and diacritics, the Polish ł included', () => {
    expect(foldSearchText('Żółć ŁĄKA')).toBe('zolc laka');
  });

  it('finds a name typed without its diacritics', () => {
    expect(searchItems(items, 'zelaz').map((i) => i.target)).toEqual([1]);
  });

  it('asks for every word, in any order', () => {
    expect(searchItems(items, 'miecz dlug').map((i) => i.target)).toEqual([2]);
    expect(searchItems(items, 'miecz').map((i) => i.target)).toEqual([2, 3]);
  });

  it('answers nothing for a blank query', () => {
    expect(searchItems(items, '   ')).toEqual([]);
  });

  it('reaches goods, buildings, jobs and animals', () => {
    const base = createKnowledgeBase(knowledgeContent());
    const groups = new Set(entrySearchItems(base).map((i) => i.target.group));
    expect(groups).toEqual(new Set(['goods', 'buildings', 'jobs', 'animals']));
  });
});
