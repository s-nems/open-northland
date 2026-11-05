import { describe, expect, it } from 'vitest';
import {
  ARTICLE_MODULES,
  type Article,
  type ArticleBlock,
  type ArticleGroup,
  articleStrings,
  parseInline,
  tokensOf,
} from '../../../src/hud/knowledge/articles.js';
import { FACTS } from '../../../src/hud/knowledge/facts/index.js';
import type { Locale } from '../../../src/i18n/index.js';

const REFERENCE: Locale = 'pol';
const DECIMAL_COMMA = /(\d),(\d)/g;
const NUMBER = /\d+(?:\.\d+)?/g;
const LINK_OR_TOKEN = /\[\[[^\]]*\]\]|\{\{[\w.]+\}\}/g;

/** The numbers a string states of its own, whatever separator the language writes decimals with. */
const digitsOf = (text: string): readonly string[] =>
  text.replace(LINK_OR_TOKEN, '').replace(DECIMAL_COMMA, '$1.$2').match(NUMBER) ?? [];

const linksOf = (text: string): readonly string[] =>
  parseInline(text).flatMap((part) => ('kind' in part ? [`${part.kind}:${part.id}`] : []));

const blockKind = (block: ArticleBlock): string => Object.keys(block).join();

function tableShape(block: ArticleBlock): unknown {
  if (!('table' in block)) return null;
  const { head, rows, num, filter, foot } = block.table;
  return {
    columns: head.length,
    rows: rows.length,
    num,
    filter: filter !== undefined,
    foot: foot !== undefined,
    cells: rows.map((row) => row.map((cell) => digitsOf(String(cell)))),
  };
}

function articleShape(article: Article): unknown {
  const strings = articleStrings(article);
  return {
    id: article.id,
    blocks: article.blocks.map((block) => ({
      kind: blockKind(block),
      table: tableShape(block),
      data: 'data' in block ? block.data : null,
      figure: 'figure' in block ? block.figure.id : null,
    })),
    tokens: strings.flatMap(tokensOf).sort(),
    links: strings.flatMap(linksOf).sort(),
    see: article.see,
  };
}

const shapeOf = (groups: readonly ArticleGroup[]): unknown =>
  groups.map((group) => group.items.map(articleShape));

const languages = Object.entries(ARTICLE_MODULES);

const loadGroups = async (language: Locale): Promise<readonly ArticleGroup[]> => {
  const load = ARTICLE_MODULES[language];
  if (load === undefined) throw new Error(`no articles for ${language}`);
  return (await load()).ARTICLES;
};

describe('article languages', () => {
  it.each(languages)('%s has the structure of the reference language', async (language) => {
    const reference = await loadGroups(REFERENCE);
    const groups = await loadGroups(language as Locale);
    expect(shapeOf(groups)).toEqual(shapeOf(reference));
  });

  it('tells a changed number from a differently written one', () => {
    const article = (cell: string): ArticleGroup[] => [
      {
        group: 'g',
        items: [{ id: 'a', name: 'a', blocks: [{ table: { head: ['x'], rows: [[cell]] } }] }],
      },
    ];
    expect(shapeOf(article('x1,25 lub 3'))).toEqual(shapeOf(article('x1.25 or 3')));
    expect(shapeOf(article('x1,25'))).not.toEqual(shapeOf(article('x1.5')));
  });

  it('names only known facts and real articles', async () => {
    const groups = await loadGroups(REFERENCE);
    const articles = groups.flatMap((group) => group.items);
    const ids = new Set(articles.map((article) => article.id));
    const strings = articles.flatMap(articleStrings);
    expect(strings.flatMap(tokensOf).filter((name) => !Object.hasOwn(FACTS, name))).toEqual([]);
    const links = [...strings.flatMap(linksOf), ...articles.flatMap((article) => article.see ?? [])];
    const articleLinks = links.filter((link) => link.startsWith('article:'));
    expect(articleLinks.filter((link) => !ids.has(link.slice('article:'.length)))).toEqual([]);
  });
});
