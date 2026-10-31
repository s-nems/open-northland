import { diag } from '../../diag/index.js';
import { currentLocale, type Locale } from '../../i18n/index.js';

export type ArticleDataBlock = 'armour' | 'animals' | 'experience' | 'homes' | 'jobs' | 'matrix' | 'vehicles';

export interface ArticleTable {
  readonly head: readonly string[];
  readonly rows: readonly (readonly (number | string)[])[];
  /** Column indexes that hold numbers and align right. */
  readonly num?: readonly number[];
  readonly foot?: string;
  /** Puts a search field over the rows; a string is the field's placeholder. */
  readonly filter?: boolean | string;
}

export interface ArticleFigure {
  readonly id: string;
  readonly caption?: string;
}

export type ArticleBlock =
  | { readonly h: string }
  | { readonly p: string }
  | { readonly table: ArticleTable }
  | { readonly list: readonly string[] }
  | { readonly steps: readonly string[] }
  | { readonly data: ArticleDataBlock }
  | { readonly faq: readonly (readonly [question: string, answer: string])[] }
  | { readonly figure: ArticleFigure };

export interface Article {
  readonly id: string;
  readonly name: string;
  readonly lead?: string;
  readonly blocks: readonly ArticleBlock[];
  /** `kind:id` links, as `data-go` takes them. */
  readonly see?: readonly string[];
}

export interface ArticleGroup {
  readonly group: string;
  readonly items: readonly Article[];
}

export interface ArticleModule {
  readonly ARTICLES: readonly ArticleGroup[];
}

export interface LoadedArticles {
  readonly groups: readonly ArticleGroup[];
}

/** One lazy chunk per language: no article text enters the first download. */
export const ARTICLE_MODULES: Readonly<Record<Locale, () => Promise<ArticleModule>>> = {
  chs: () => import('../../i18n/knowledge/chs/index.js'),
  cht: () => import('../../i18n/knowledge/cht/index.js'),
  eng: () => import('../../i18n/knowledge/eng/index.js'),
  ger: () => import('../../i18n/knowledge/ger/index.js'),
  pol: () => import('../../i18n/knowledge/pol/index.js'),
  rus: () => import('../../i18n/knowledge/rus/index.js'),
};

const pending = new Map<Locale, Promise<LoadedArticles | null>>();
const loaded = new Map<Locale, LoadedArticles>();

/** Loads the articles once a language; null when the chunk fails, and the next call tries again. */
export function loadArticles(language: Locale = currentLocale()): Promise<LoadedArticles | null> {
  const running = pending.get(language);
  if (running !== undefined) return running;
  const started = ARTICLE_MODULES[language]().then(
    ({ ARTICLES }) => {
      const articles = { groups: ARTICLES };
      loaded.set(language, articles);
      return articles;
    },
    (error: unknown) => {
      diag.warn('hud', `knowledge articles ${language}: ${String(error)}`);
      pending.delete(language);
      return null;
    },
  );
  pending.set(language, started);
  return started;
}

/** What {@link loadArticles} has finished for `locale`; null before that. */
export function loadedArticles(locale: Locale = currentLocale()): LoadedArticles | null {
  return loaded.get(locale) ?? null;
}

export function findArticle(articles: LoadedArticles, id: string): Article | undefined {
  return articles.groups.flatMap((group) => group.items).find((article) => article.id === id);
}

export type InlineLinkKind = 'animal' | 'article' | 'building' | 'good' | 'job' | 'vehicle';

export type InlinePart =
  | { readonly text: string }
  | { readonly kind: InlineLinkKind; readonly id: string; readonly label: string };

const LINK = /\[\[(good|building|job|article|vehicle|animal):([^|\]]+)\|([^\]]+)\]\]/g;
const TOKEN = /\{\{([\w.]+)\}\}/g;

function isLinkKind(kind: string | undefined): kind is InlineLinkKind {
  return (
    kind === 'animal' ||
    kind === 'article' ||
    kind === 'building' ||
    kind === 'good' ||
    kind === 'job' ||
    kind === 'vehicle'
  );
}

/** Splits an article string into plain runs and `[[kind:id|label]]` links. */
export function parseInline(text: string): readonly InlinePart[] {
  const parts: InlinePart[] = [];
  let at = 0;
  for (const match of text.matchAll(LINK)) {
    const [whole, kind, id, label] = match;
    if (!isLinkKind(kind) || id === undefined || label === undefined) continue;
    if (match.index > at) parts.push({ text: text.slice(at, match.index) });
    parts.push({ kind, id, label });
    at = match.index + whole.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

/** Replaces each `{{name}}` by what `value` answers; an unknown name stays as written. */
export function fillTokens(text: string, value: (name: string) => string | undefined): string {
  return text.replace(TOKEN, (token, name: string) => value(name) ?? token);
}

export function tokensOf(text: string): readonly string[] {
  return [...text.matchAll(TOKEN)].flatMap((match) => match[1] ?? []);
}

/** Every string a block shows, in reading order. */
export function blockStrings(block: ArticleBlock): readonly string[] {
  if ('h' in block) return [block.h];
  if ('p' in block) return [block.p];
  if ('list' in block) return block.list;
  if ('steps' in block) return block.steps;
  if ('faq' in block) return block.faq.flat();
  if ('data' in block) return [];
  if ('figure' in block) return block.figure.caption === undefined ? [] : [block.figure.caption];
  const { head, rows, foot, filter } = block.table;
  return [
    ...head,
    ...rows.flat().map(String),
    ...(foot === undefined ? [] : [foot]),
    ...(typeof filter === 'string' ? [filter] : []),
  ];
}

export function articleStrings(article: Article): readonly string[] {
  return [
    article.name,
    ...(article.lead === undefined ? [] : [article.lead]),
    ...article.blocks.flatMap(blockStrings),
  ];
}
