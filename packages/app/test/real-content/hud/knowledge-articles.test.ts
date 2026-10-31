import { describe, expect, it } from 'vitest';
import { articleStrings, parseInline } from '../../../src/hud/knowledge/articles.js';
import { createKnowledgeBase } from '../../../src/hud/knowledge/base.js';
import {
  blowResult,
  duelResult,
  initialCalculator,
  ranking,
  weaponGroups,
} from '../../../src/hud/knowledge/calculator.js';
import { ARTICLES } from '../../../src/i18n/knowledge/pol/index.js';
import { hasRealIr, loadContentUnderTest } from '../helpers.js';

const articles = ARTICLES.flatMap((group) => group.items);

describe.runIf(hasRealIr())('the Mechaniki tab over the decoded content', () => {
  it('links only to entries that exist', async () => {
    const { merge } = await loadContentUnderTest();
    const base = createKnowledgeBase(merge.content);
    const known: Readonly<Record<string, (id: string) => boolean>> = {
      article: (id) => articles.some((article) => article.id === id),
      animal: (id) => base.animals.some((a) => String(a.tribe) === id),
      building: (id) => base.buildingById.has(id),
      good: (id) => base.goodById.has(id),
      job: (id) => base.jobById.has(id),
      vehicle: (id) => base.vehicles.some((v) => v.id === id),
    };
    const links = articles.flatMap((article) => [
      ...articleStrings(article)
        .flatMap(parseInline)
        .flatMap((part) => ('kind' in part ? [`${part.kind}:${part.id}`] : [])),
      ...(article.see ?? []),
    ]);
    const dead = links.filter((link) => {
      const at = link.indexOf(':');
      return known[link.slice(0, at)]?.(link.slice(at + 1)) !== true;
    });
    expect([...new Set(dead)]).toEqual([]);
  });

  it('answers a fight for every tribe', async () => {
    const { merge } = await loadContentUnderTest();
    const base = createKnowledgeBase(merge.content);
    for (const { typeId } of base.tribes) {
      const state = { ...initialCalculator(base, typeId), heroes: true };
      expect(weaponGroups(base, typeId, true).length).toBeGreaterThan(1);
      expect(blowResult(base, state)?.seconds).toBeGreaterThan(0);
      expect(ranking(base, state)[0]?.share).toBe(1);
      expect(duelResult(base, state.duel)?.verdict.kind).toBe('draw');
    }
  });
});
