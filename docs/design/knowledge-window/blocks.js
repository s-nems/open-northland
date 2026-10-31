// Renders an article's blocks. Text carries `[[good:id|Nazwa]]` links, the rest is escaped.
import { esc, goodById, goodIcon } from './model.js';

const LINK = /\[\[(good|building|job|article|vehicle|animal):([^|\]]+)\|([^\]]+)\]\]/g;

export function inline(text) {
  return esc(text).replace(LINK, (_, kind, id, label) =>
    kind === 'article'
      ? `<button class="kn-link" data-article="${id}"><span>${label}</span></button>`
      : `<button class="kn-link" data-go="${kind}:${id}"><span>${label}</span></button>`,
  );
}

export const goodCell = (id) => {
  const good = goodById.get(id);
  return `<button class="kn-link" data-go="good:${id}">${goodIcon(good)}<span>${esc(good.name)}</span></button>`;
};

/** A table of ready HTML cells; a column of numbers aligns itself. */
export function plainTable(head, rows, foot = '') {
  const numeric = head.map((_, i) => i > 0 && rows.every((r) => typeof r[i] === 'number'));
  return `<table class="kn-table"><thead><tr>${head.map((h, i) => `<th class="${numeric[i] ? 'kn-num' : ''}">${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${numeric[i] ? 'kn-num' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>${foot === '' ? '' : `<p class="kn-foot">${foot}</p>`}`;
}

function tableBlock({ head, rows, num = [], foot }) {
  const align = (i) => (num.includes(i) ? 'kn-num' : '');
  return `<table class="kn-table"><thead><tr>${head.map((h, i) => `<th class="${align(i)}">${inline(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${inline(String(c))}</th>` : `<td class="${align(i)}">${inline(String(c))}</td>`)).join('')}</tr>`).join('')}</tbody></table>${foot === undefined ? '' : `<p class="kn-foot">${inline(foot)}</p>`}`;
}

function faqBlock(rows) {
  return rows
    .map(
      ([q, a]) => `<details class="kn-faq" open><summary>${inline(q)}</summary><p>${inline(a)}</p></details>`,
    )
    .join('');
}

export function renderBlock(block, state, dataBlocks) {
  if (block.h !== undefined) return `<h3 class="kn-h">${inline(block.h)}</h3>`;
  if (block.p !== undefined) return `<p>${inline(block.p)}</p>`;
  if (block.table !== undefined) return tableBlock(block.table);
  if (block.list !== undefined)
    return `<ul class="kn-steps">${block.list.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`;
  if (block.steps !== undefined)
    return `<ol class="kn-formula">${block.steps.map((i) => `<li>${inline(i)}</li>`).join('')}</ol>`;
  if (block.faq !== undefined) return faqBlock(block.faq);
  if (block.data !== undefined) return dataBlocks[block.data](state);
  throw new Error(`article block with no known shape: ${JSON.stringify(block)}`);
}
