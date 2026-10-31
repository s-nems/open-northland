import { formatMessage, messages } from '../../../i18n/index.js';
import { billOf, sourceNameOf } from '../../knowledge/chains.js';
import {
  BUILDING_LANES,
  GOOD_LANES,
  type Lane,
  type LaneNode,
  laneCaption,
  laneName,
} from '../../knowledge/lanes.js';
import type { EntryRef, KnowledgeBase, KnowledgeBuilding, KnowledgeGood } from '../../knowledge/model.js';
import {
  BUILDING_CARD_HEIGHT,
  buildingKey,
  CARD_WIDTH,
  GOOD_CARD_HEIGHT,
  goodKey,
  layoutLane,
  relateBuilding,
  relateGood,
  spotLine,
  type TreeLaneLayout,
  type TreeRelation,
  tradeOf,
  treeNodeOf,
} from '../../knowledge/tree-layout.js';
import { goodIconMarkup } from '../good-art.js';
import type { KnowledgeContext, KnowledgeStatus, KnowledgeTree } from './context.js';
import { createTreePane } from './tree-pane.js';
import './tree.css';

/** What outlives one mount of a tree: the scale of each, in percent. */
export type TreeScales = Record<KnowledgeTree, number>;

export const SCALE_DEFAULT_PCT = 100;
const SCALE_MIN_PCT = 50;
const SCALE_MAX_PCT = 130;
const SCALE_STEP_PCT = 5;
const PERCENT = 100;
const GOOD_ICON_PX = 30;
const INPUT_ICON_PX = 17;
const TIGHT_INPUT_ICON_PX = 14;
/** What a recipe row on a card has to itself, and what it spends at the full size. */
const INPUT_ROW_PX = 118;
const INPUT_GAP_PX = 5;
const AMOUNT_PX = 17;
const THUMB_PX = 40;
const SVG_NS = 'http://www.w3.org/2000/svg';

export interface TreeViewDeps {
  readonly scales: TreeScales;
  /** The reader's click on the pane's close button. */
  readonly onClosePane: () => void;
}

export interface TreeView {
  readonly element: HTMLElement;
  /** Move the pin and its pane to `ref`, or drop both. */
  pin(ref: EntryRef | null): void;
  dispose(): void;
}

interface Card {
  readonly key: string;
  readonly className: string;
  readonly title: string;
  readonly fill: (card: HTMLElement) => void;
}

const span = (className: string, text: string): HTMLElement => {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
};

function goodPicture(context: KnowledgeContext, goodId: string, boxPx: number): HTMLElement {
  const holder = document.createElement('span');
  holder.innerHTML = goodIconMarkup(boxPx);
  const slot = holder.firstElementChild;
  if (!(slot instanceof HTMLElement)) throw new Error('knowledge tree: icon slot missing');
  const frame = slot.firstElementChild;
  if (frame instanceof HTMLElement) context.art.goodIcon(frame, goodId, boxPx);
  return slot;
}

const amountText = (amount: number): string => formatMessage(messages().knowledge.tree.amount, { amount });

/** A recipe too long for its row at the full size. */
function crowded(inputs: readonly { readonly amount: number }[]): boolean {
  const amounts = inputs.filter((input) => input.amount > 1).length;
  const spent = inputs.length * (INPUT_ICON_PX + INPUT_GAP_PX) - INPUT_GAP_PX + amounts * AMOUNT_PX;
  return spent > INPUT_ROW_PX;
}

function goodCard(context: KnowledgeContext, good: KnowledgeGood): Card {
  const copy = messages().knowledge.tree;
  const inputs = billOf(context.base, good);
  const source = sourceNameOf(context.base, good);
  const recipe = inputs
    .map((i) => (i.amount > 1 ? `${amountText(i.amount)} ${i.good.name}` : i.good.name))
    .join(inputs[1]?.alternative === true ? ` ${copy.or} ` : ' + ');
  return {
    key: goodKey(good.id),
    className: '',
    title: `${good.name}: ${inputs.length === 0 ? source : recipe}`,
    fill: (card) => {
      const text = document.createElement('span');
      text.className = 'kn-card__text';
      const name = document.createElement('b');
      name.textContent = good.name;
      text.append(name);
      if (inputs.length === 0) text.append(span('kn-card__from', source));
      else {
        const tight = crowded(inputs);
        const list = document.createElement('span');
        list.className = tight ? 'kn-card__in kn-card__in--tight' : 'kn-card__in';
        for (const input of inputs) {
          if (input.alternative) list.append(span('kn-card__or', copy.or));
          const item = document.createElement('span');
          item.className = 'kn-card__input';
          item.append(goodPicture(context, input.good.id, tight ? TIGHT_INPUT_ICON_PX : INPUT_ICON_PX));
          if (input.amount > 1) item.append(span('kn-card__amount', amountText(input.amount)));
          list.append(item);
        }
        text.append(list);
      }
      card.append(goodPicture(context, good.id, GOOD_ICON_PX), text);
    },
  };
}

function statusLook(
  status: KnowledgeStatus,
  worker: string,
): { readonly kind: string; readonly line: string; readonly long: string } {
  const copy = messages().knowledge.tree;
  switch (status.kind) {
    case 'available':
      return { kind: '', line: worker, long: '' };
    case 'mapForbidden':
      return { kind: ' kn-card--map', line: copy.mapForbidden, long: copy.mapForbiddenLong };
    case 'locked': {
      const [first = '', ...rest] = status.missing;
      const line =
        rest.length === 0
          ? formatMessage(copy.missing, { first })
          : formatMessage(copy.missingMore, { first, more: rest.length });
      return { kind: ' kn-card--locked', line, long: status.missing.join(', ') };
    }
  }
}

function buildingCard(context: KnowledgeContext, building: KnowledgeBuilding): Card {
  const worker = tradeOf(context.base, building);
  const status = context.settlement?.status('building', building.typeId) ?? { kind: 'available' };
  const look = statusLook(status, worker?.name ?? '');
  return {
    key: buildingKey(building.id),
    className: ` kn-card--building${look.kind}`,
    title: look.long === '' ? building.name : `${building.name}: ${look.long}`,
    fill: (card) => {
      const thumb = document.createElement('img');
      thumb.className = 'kn-thumb';
      thumb.alt = '';
      if (context.art.buildingThumb(thumb, building.typeId, THUMB_PX, context.tribe())) card.append(thumb);
      const text = document.createElement('span');
      text.className = 'kn-card__text';
      const name = document.createElement('b');
      name.textContent = building.name;
      text.append(name, span('kn-card__from', look.line));
      card.append(text);
    },
  };
}

interface TreeShape {
  readonly lanes: readonly Lane[];
  readonly cardHeight: number;
  readonly flow: 'columns' | 'rows';
  readonly key: (id: string) => string;
  readonly card: (id: string) => Card | null;
  readonly relate: (key: string, pinned: boolean) => TreeRelation;
  readonly legend: readonly [up: string, down: string];
}

function shapeOf(context: KnowledgeContext, tree: KnowledgeTree): TreeShape {
  const { base } = context;
  const copy = messages().knowledge.tree;
  if (tree === 'goods') {
    return {
      lanes: GOOD_LANES,
      cardHeight: GOOD_CARD_HEIGHT,
      flow: 'columns',
      key: goodKey,
      card: (id) => {
        const good = base.goodById.get(id);
        return good === undefined ? null : goodCard(context, good);
      },
      relate: (key, pinned) => relateGood(base, key, pinned),
      legend: [copy.goodsUp, copy.goodsDown],
    };
  }
  return {
    lanes: BUILDING_LANES,
    cardHeight: BUILDING_CARD_HEIGHT,
    flow: 'rows',
    key: buildingKey,
    card: (id) => {
      const building = base.buildingById.get(id);
      return building === undefined ? null : buildingCard(context, building);
    },
    relate: (key) => relateBuilding(base, key),
    legend: [copy.buildingsUp, copy.buildingsDown],
  };
}

function laneIds(lanes: readonly Lane[]): ReadonlySet<string> {
  const ids = new Set<string>();
  const walk = (node: LaneNode): void => {
    ids.add(node.id);
    node.kids.forEach(walk);
  };
  for (const lane of lanes) lane.roots.forEach(walk);
  return ids;
}

const GOOD_IDS = laneIds(GOOD_LANES);
const BUILDING_IDS = laneIds(BUILDING_LANES);

/** Whether `tree` shows a card for `ref`, mounted or not. */
export function treeHolds(base: KnowledgeBase, tree: KnowledgeTree, ref: EntryRef): boolean {
  if (tree === 'goods') return ref.kind === 'good' && GOOD_IDS.has(ref.id) && base.goodById.has(ref.id);
  return ref.kind === 'building' && BUILDING_IDS.has(ref.id) && base.buildingById.has(ref.id);
}

interface DrawnLine {
  readonly from: string;
  readonly to: string;
  readonly group: SVGGElement;
}

const svgNode = <K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] =>
  document.createElementNS(SVG_NS, tag);

const pathOf = (d: string, className?: string): SVGPathElement => {
  const path = svgNode('path');
  path.setAttribute('d', d);
  if (className !== undefined) path.setAttribute('class', className);
  return path;
};

function laneElement(
  lane: Lane,
  caption: string | undefined,
  layout: TreeLaneLayout,
  cards: ReadonlyMap<string, Card>,
  lit: { readonly cards: Map<string, HTMLElement>; readonly lines: DrawnLine[] },
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'kn-lane';
  section.style.setProperty('--lane-w', `${layout.width}px`);
  const head = document.createElement('h3');
  head.className = 'kn-lane__head';
  head.textContent = laneName(lane);
  if (caption !== undefined) {
    const small = document.createElement('small');
    small.textContent = caption;
    head.append(small);
  }
  const plane = document.createElement('div');
  plane.className = 'kn-lane__plane';
  plane.style.width = `${layout.width}px`;
  plane.style.height = `${layout.height}px`;
  const svg = svgNode('svg');
  svg.setAttribute('width', String(layout.width));
  svg.setAttribute('height', String(layout.height));
  for (const line of layout.lines) {
    const group = svgNode('g');
    group.setAttribute('class', 'kn-line');
    group.append(pathOf(line.path), pathOf(line.head, 'kn-line__head'));
    svg.append(group);
    lit.lines.push({ from: line.from, to: line.to, group });
  }
  plane.append(svg);
  for (const placed of layout.cards) {
    const card = cards.get(placed.key);
    if (card === undefined) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `kn-card${card.className}`;
    button.dataset.node = card.key;
    button.dataset.go = card.key;
    button.title = card.title;
    button.style.left = `${placed.x}px`;
    button.style.top = `${placed.y}px`;
    button.style.width = `${placed.width}px`;
    button.style.height = `${placed.height}px`;
    card.fill(button);
    plane.append(button);
    lit.cards.set(card.key, button);
  }
  section.append(head, plane);
  return section;
}

/** The authored nodes the content holds; a missing card's children take its place. */
function shownNodes(roots: readonly LaneNode[], has: (id: string) => boolean): readonly LaneNode[] {
  return roots.flatMap((node) => {
    const kids = shownNodes(node.kids, has);
    return has(node.id) ? [{ id: node.id, kids }] : kids;
  });
}

/** Where a card sits in the tree plane, in unzoomed pixels: client rects carry the HUD scale and the zoom. */
function planeRect(card: HTMLElement, plane: DOMRect, scale: number) {
  const box = card.getBoundingClientRect();
  return {
    left: (box.left - plane.left) / scale,
    right: (box.right - plane.left) / scale,
    mid: ((box.top + box.bottom) / 2 - plane.top) / scale,
  };
}

/** The tree of Towary or Budynki: a line joins a card to its parent in the lane, a card lists its other
 *  inputs itself, and a lit chain draws the links that leave the lane over everything else. */
export function createTreeView(context: KnowledgeContext, tree: KnowledgeTree, deps: TreeViewDeps): TreeView {
  const shape = shapeOf(context, tree);
  const cards = new Map<string, Card>();
  const has = (id: string): boolean => {
    const key = shape.key(id);
    if (cards.has(key)) return true;
    const card = shape.card(id);
    if (card !== null) cards.set(key, card);
    return card !== null;
  };
  const lit = { cards: new Map<string, HTMLElement>(), lines: [] as DrawnLine[] };

  const element = document.createElement('div');
  element.className = 'kn-treeview';
  element.dataset.tree = tree;
  const scroller = document.createElement('div');
  scroller.className = 'kn-treescroll';
  scroller.dataset.keepScroll = `tree-${tree}`;
  const zoomed = document.createElement('div');
  zoomed.className = 'kn-treezoom';
  const lanes = document.createElement('div');
  lanes.className = `kn-lanes kn-lanes--${shape.flow}`;
  for (const lane of shape.lanes) {
    const roots = shownNodes(lane.roots, has).map((root) => treeNodeOf(root, shape.key));
    if (roots.length === 0) continue;
    lanes.append(
      laneElement(lane, laneCaption(context.base, lane), layoutLane(roots, shape.cardHeight), cards, lit),
    );
  }
  const overlay = svgNode('svg');
  overlay.setAttribute('class', 'kn-spot');
  overlay.setAttribute('aria-hidden', 'true');
  zoomed.append(lanes, overlay);
  scroller.append(zoomed);

  const legend = document.createElement('div');
  legend.className = 'kn-legend';
  for (const [kind, text] of [
    ['up', shape.legend[0]],
    ['down', shape.legend[1]],
  ] as const) {
    const item = document.createElement('span');
    const swatch = document.createElement('i');
    swatch.className = `kn-swatch kn-swatch--${kind}`;
    item.append(swatch, text);
    legend.append(item);
  }

  const copy = messages().knowledge.tree;
  const scaleBox = document.createElement('label');
  scaleBox.className = 'kn-zoom';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(SCALE_MIN_PCT);
  slider.max = String(SCALE_MAX_PCT);
  slider.step = String(SCALE_STEP_PCT);
  slider.setAttribute('aria-label', copy.scaleLabel);
  const scaleOut = document.createElement('output');
  scaleBox.append(span('', copy.scale), slider, scaleOut);

  const treeSide = document.createElement('div');
  treeSide.className = 'kn-treeside';
  treeSide.append(scroller, legend, scaleBox);
  const pane = createTreePane(context, deps.onClosePane);
  element.append(treeSide, pane.element);

  const drawnPairs = new Set(lit.lines.map((l) => `${l.from}>${l.to}`));
  let pinned: string | null = null;
  let pointed: string | null = null;

  const drawOverlay = (related: TreeRelation | null): void => {
    overlay.replaceChildren();
    const sample = lit.cards.values().next().value;
    if (related === null || sample === undefined) return;
    const scale = sample.getBoundingClientRect().width / CARD_WIDTH;
    if (scale === 0) return;
    const plane = zoomed.getBoundingClientRect();
    overlay.setAttribute('width', String(plane.width / scale));
    overlay.setAttribute('height', String(plane.height / scale));
    for (const link of related.links) {
      if (drawnPairs.has(`${link.from}>${link.to}`)) continue;
      const from = lit.cards.get(link.from);
      const to = lit.cards.get(link.to);
      if (from === undefined || to === undefined) continue;
      const line = spotLine(planeRect(from, plane, scale), planeRect(to, plane, scale));
      const group = svgNode('g');
      group.setAttribute('class', `kn-spotline kn-spotline--${link.kind}`);
      group.append(
        pathOf(line.path, 'kn-spotline__halo'),
        pathOf(line.path),
        pathOf(line.head, 'kn-line__head'),
      );
      overlay.append(group);
    }
  };

  const relationOf = (key: string | null): TreeRelation | null =>
    key === null ? null : shape.relate(key, key === pinned);

  /** Pointing previews a chain; without a pointed card the pin holds it. */
  const light = (): void => {
    const key = pointed ?? pinned;
    const related = relationOf(key);
    element.classList.toggle('is-spot', related !== null);
    for (const [node, card] of lit.cards) {
      card.classList.toggle('is-self', node === key);
      card.classList.toggle('is-pinned', node === pinned);
      card.classList.toggle('is-up', related?.up.has(node) ?? false);
      card.classList.toggle('is-down', related?.down.has(node) ?? false);
    }
    for (const line of lit.lines) {
      const up = related?.up.has(line.from) === true && (related.up.has(line.to) || line.to === key);
      const down = related?.down.has(line.to) === true && (related.down.has(line.from) || line.from === key);
      line.group.classList.toggle('is-up', up);
      line.group.classList.toggle('is-down', down);
    }
    drawOverlay(related);
  };

  const setScale = (percent: number): void => {
    const stepped = Math.round(percent / SCALE_STEP_PCT) * SCALE_STEP_PCT;
    const scale = Math.min(SCALE_MAX_PCT, Math.max(SCALE_MIN_PCT, stepped));
    deps.scales[tree] = scale;
    zoomed.style.setProperty('zoom', String(scale / PERCENT));
    slider.value = String(scale);
    scaleOut.textContent = `${scale}%`;
    drawOverlay(relationOf(pointed ?? pinned));
  };

  slider.addEventListener('input', () => setScale(Number(slider.value)));
  element.addEventListener(
    'wheel',
    (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      setScale(deps.scales[tree] + (event.deltaY < 0 ? SCALE_STEP_PCT : -SCALE_STEP_PCT));
    },
    { passive: false },
  );
  scroller.addEventListener('pointermove', (event) => {
    const hit = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-node]') : null;
    const key = hit?.dataset.node ?? null;
    if (key === pointed) return;
    pointed = key;
    light();
  });
  scroller.addEventListener('pointerleave', () => {
    if (pointed === null) return;
    pointed = null;
    light();
  });

  // The pane narrows the tree and the lanes reflow, so the links are measured again.
  const resizes =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => drawOverlay(relationOf(pointed ?? pinned)));
  resizes?.observe(zoomed);

  /** Bring a card into the tree's own scroll only when it is out of view, so a click never jumps. */
  const reveal = (card: HTMLElement): void => {
    const view = scroller.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    if (view.width === 0 || scroller.clientWidth === 0) return;
    const hudScale = view.width / scroller.clientWidth;
    const centred = (near: number, far: number, viewNear: number, viewFar: number): number =>
      ((near + far) / 2 - (viewNear + viewFar) / 2) / hudScale;
    if (box.top < view.top || box.bottom > view.bottom) {
      scroller.scrollTop += centred(box.top, box.bottom, view.top, view.bottom);
    }
    if (box.left < view.left || box.right > view.right) {
      scroller.scrollLeft += centred(box.left, box.right, view.left, view.right);
    }
  };

  setScale(deps.scales[tree]);

  return {
    element,
    pin: (ref) => {
      const key = ref === null ? null : shape.key(ref.id);
      if (key === pinned) return;
      pinned = key;
      if (ref === null) pane.hide();
      else pane.show(ref);
      light();
      const card = pinned === null ? undefined : lit.cards.get(pinned);
      if (card !== undefined) reveal(card);
    },
    dispose: () => {
      resizes?.disconnect();
    },
  };
}
