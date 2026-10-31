import { inline, renderBlock } from './blocks.js';
import { DATA_BLOCKS } from './data-blocks.js';
import { esc, goodById } from './model.js';

const FILES = ['settlers', 'experience', 'economy', 'military', 'world', 'problems'];
const loaded = await Promise.allSettled(FILES.map((file) => import(`./articles/${file}.js`)));
/** The rail's groups, in reading order. */
export const ARTICLES = loaded.flatMap((result) =>
  result.status === 'fulfilled' ? [result.value.GROUP] : [],
);
export const ARTICLE_LIST = ARTICLES.flatMap((group) => group.items);

const seeLink = (key) => {
  const at = key.indexOf(':');
  const kind = key.slice(0, at);
  const id = key.slice(at + 1);
  if (kind === 'article') {
    const name = ARTICLE_LIST.find((a) => a.id === id)?.name ?? id;
    return `<button class="kn-link" data-article="${id}"><span>${esc(name)}</span></button>`;
  }
  const name = kind === 'good' ? (goodById.get(id)?.name ?? id) : id;
  return `<button class="kn-link" data-go="${esc(key)}"><span>${esc(name)}</span></button>`;
};

export function mechanicsView(state) {
  const rail = ARTICLES.map(
    (g) =>
      `<h4>${g.group}</h4>${g.items.map((a) => `<button class="kn-rail__item" aria-current="${state.article === a.id}" data-article="${a.id}"><span>${a.name}</span></button>`).join('')}`,
  ).join('');
  const article = ARTICLE_LIST.find((a) => a.id === state.article) ?? ARTICLE_LIST[0];
  if (article === undefined) return '<p class="kn-empty">Artykuły w przygotowaniu.</p>';
  const lead = article.lead === undefined ? '' : `<p class="kn-lead">${inline(article.lead)}</p>`;
  const see =
    article.see === undefined || article.see.length === 0
      ? ''
      : `<p class="kn-seealso">Zobacz też: ${article.see.map(seeLink).join(' ')}</p>`;
  return `<div class="kn-book"><nav class="kn-rail" data-keep-scroll="art-rail">${rail}</nav>
    <div class="on-parchment kn-page" data-keep-scroll="article-${article.id}"><article class="kn-article"><h2 class="kn-title">${esc(article.name)}</h2>${lead}${article.blocks.map((b) => renderBlock(b, state, DATA_BLOCKS)).join('')}${see}</article></div></div>`;
}
