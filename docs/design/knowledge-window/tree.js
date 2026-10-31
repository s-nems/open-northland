// The trees of Towary and Budynki. A line only ever joins a card to its parent in the same lane, so lines
// cannot cross; a card lists its other inputs itself. Pointing at a card lights its whole chain, and only
// then draws the links that leave the lane.
import { esc } from './model.js';

const CARD_W = 166;
const GUTTER = 36;
const ROW_GAP = 8;
const PAD = 8;
const CORNER = 7;
const ARROW = 7;

/** A subtree's cards relative to its root, each parent level with its first child, so that child's line
 *  runs straight. */
function shape(node, col, row, cards, buses) {
  const at = { node, col, row };
  cards.push(at);
  if (node.kids.length === 0) return { at, next: row + 1 };
  let next = row;
  at.kids = node.kids.map((kid) => {
    const placed = shape(kid, col + 1, next, cards, buses);
    next = placed.next;
    return placed.at;
  });
  for (let r = row; r <= at.kids.at(-1).row; r += 1) buses.push({ col, row: r });
  return { at, next };
}

/** Each root takes the first row where its cards and its lines touch nothing already placed. */
function placeRoots(roots) {
  const taken = new Set();
  const placed = [];
  for (const root of roots) {
    const cards = [];
    const buses = [];
    shape(root, 0, 0, cards, buses);
    const cells = (dy) => [
      ...cards.map((c) => `c${c.col}:${c.row + dy}`),
      ...buses.map((b) => `g${b.col}:${b.row + dy}`),
    ];
    let dy = 0;
    while (cells(dy).some((cell) => taken.has(cell))) dy += 1;
    for (const cell of cells(dy)) taken.add(cell);
    for (const card of cards) card.row += dy;
    placed.push(...cards);
  }
  return placed;
}

function linePath(x1, y1, x2, y2) {
  if (y1 === y2) return `M${x1} ${y1}H${x2}`;
  const bus = x1 + GUTTER / 2 - ARROW / 2;
  return `M${x1} ${y1}H${bus - CORNER}Q${bus} ${y1} ${bus} ${y1 + CORNER}V${y2 - CORNER}Q${bus} ${y2} ${bus + CORNER} ${y2}H${x2}`;
}

export const arrowHead = (x, y) => `M${x} ${y}l-${ARROW} -${ARROW - 2}v${(ARROW - 2) * 2}z`;

function laneHtml(lane, cardH) {
  const placed = placeRoots(lane.roots);
  const lastCol = Math.max(...placed.map((p) => p.col));
  const rows = 1 + Math.max(...placed.map((p) => p.row));
  const xOf = (col) => PAD + col * (CARD_W + GUTTER);
  const yOf = (row) => PAD + row * (cardH + ROW_GAP);
  const width = xOf(lastCol) + CARD_W + PAD;
  const height = yOf(rows) - ROW_GAP + PAD;
  const lines = placed
    .flatMap((parent) =>
      (parent.kids ?? []).map((kid) => {
        const x1 = xOf(parent.col) + CARD_W;
        const y1 = yOf(parent.row) + cardH / 2;
        const x2 = xOf(kid.col);
        const y2 = yOf(kid.row) + cardH / 2;
        return `<g class="kn-line" data-from="${parent.node.key}" data-to="${kid.node.key}"><path d="${linePath(x1, y1, x2 - ARROW, y2)}"/><path class="kn-line__head" d="${arrowHead(x2, y2)}"/></g>`;
      }),
    )
    .join('');
  const cards = placed
    .map(
      ({ node, col, row }) =>
        `<button class="kn-card ${node.className ?? ''}" data-node="${node.key}" data-go="${node.key}" title="${esc(node.title)}" style="left:${xOf(col)}px;top:${yOf(row)}px;width:${CARD_W}px;height:${cardH}px">${node.html}</button>`,
    )
    .join('');
  return `<section class="kn-lane" style="--lane-w:${width}px">
    <h3 class="kn-lane__head">${esc(lane.name)}${lane.caption === undefined ? '' : `<small>${esc(lane.caption)}</small>`}</h3>
    <div class="kn-lane__plane" style="width:${width}px;height:${height}px"><svg width="${width}" height="${height}">${lines}</svg>${cards}</div>
  </section>`;
}

export function treeHtml({ id, lanes, cardH, zoom, flow, legend }) {
  const percent = Math.round(zoom * 100);
  return `<div class="kn-treeview" data-tree="${id}">
    <div class="kn-treescroll" data-keep-scroll="tree-${id}">
      <div class="kn-treezoom" style="zoom:${zoom}">
        <div class="kn-lanes kn-lanes--${flow}">${lanes.map((lane) => laneHtml(lane, cardH)).join('')}</div>
        <svg class="kn-spot" aria-hidden="true"></svg>
      </div>
    </div>
    <div class="kn-legend">${legend.map(([kind, text]) => `<span><i class="kn-swatch kn-swatch--${kind}"></i>${text}</span>`).join('')}</div>
    <label class="kn-zoom"><span>Skala</span><input type="range" min="50" max="130" step="5" value="${percent}" data-zoom="${id}" aria-label="Skala drzewa"><output>${percent}%</output></label>
  </div>`;
}

/** Where a card sits inside the zoomed plane: client rects are scaled by the stage and the zoom. */
function planeRect(card, plane, scale) {
  const box = card.getBoundingClientRect();
  return {
    left: (box.left - plane.left) / scale,
    right: (box.right - plane.left) / scale,
    mid: ((box.top + box.bottom) / 2 - plane.top) / scale,
  };
}

function spotLine(from, to, kind) {
  const span = Math.max(40, Math.abs(to.left - from.right) / 2);
  const x2 = to.left - ARROW;
  return `<g class="kn-spotline kn-spotline--${kind}"><path d="M${from.right} ${from.mid}C${from.right + span} ${from.mid},${x2 - span} ${to.mid},${x2} ${to.mid}"/><path class="kn-line__head" d="${arrowHead(to.left, to.mid)}"/></g>`;
}

/** Light a card's chain. `relate(key)` gives `up` and `down` key sets and the `links` worth drawing. */
export function spotlight(view, key, relate) {
  const related = key === null ? null : relate(key);
  view.classList.toggle('is-spot', related !== null);
  for (const card of view.querySelectorAll('.kn-card')) {
    const node = card.dataset.node;
    card.classList.toggle('is-self', node === key);
    card.classList.toggle('is-up', related?.up.has(node) ?? false);
    card.classList.toggle('is-down', related?.down.has(node) ?? false);
  }
  for (const line of view.querySelectorAll('.kn-line')) {
    const { from, to } = line.dataset;
    const inUp = (related?.up.has(from) ?? false) && (related?.up.has(to) || to === key);
    const inDown = (related?.down.has(to) ?? false) && (related?.down.has(from) || from === key);
    line.classList.toggle('is-up', inUp);
    line.classList.toggle('is-down', inDown);
  }
  const svg = view.querySelector('.kn-spot');
  const zoomed = view.querySelector('.kn-treezoom');
  if (related === null) {
    svg.innerHTML = '';
    return;
  }
  const plane = zoomed.getBoundingClientRect();
  const anyCard = view.querySelector('.kn-card');
  const scale = anyCard.getBoundingClientRect().width / CARD_W;
  svg.setAttribute('width', String(plane.width / scale));
  svg.setAttribute('height', String(plane.height / scale));
  const rect = (node) => {
    const card = view.querySelector(`[data-node="${node}"]`);
    return card === null ? null : planeRect(card, plane, scale);
  };
  const drawn = (from, to) => view.querySelector(`.kn-line[data-from="${from}"][data-to="${to}"]`) !== null;
  svg.innerHTML = related.links
    .filter((link) => !drawn(link.from, link.to))
    .map((link) => {
      const from = rect(link.from);
      const to = rect(link.to);
      return from === null || to === null ? '' : spotLine(from, to, link.kind);
    })
    .join('');
}
