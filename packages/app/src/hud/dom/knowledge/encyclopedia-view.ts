import { compareLabels, messages } from '../../../i18n/index.js';
import {
  type CategoryRow,
  categoryRows,
  ENTRY_CATEGORIES,
  type EntryCategory,
  placeOf,
} from '../../knowledge/entry-blocks.js';
import type { EntryRef } from '../../knowledge/model.js';
import { button, element, write } from '../parts/dom.js';
import type { KnowledgeContext } from './context.js';
import { buildingPicture, emptyEntry, goodIcon, node } from './entry-parts.js';
import { renderEntry } from './entry-view.js';

const ROW_PICTURE_PX = 26;
const DEFAULT_CATEGORY: EntryCategory = 'goods';

const keyOf = (entry: EntryRef): string => `${entry.kind}:${entry.id}`;

function rowPicture(context: KnowledgeContext, { entry }: CategoryRow): Node | null {
  const { base, art } = context;
  if (entry.kind === 'good' || entry.kind === 'vehicle') {
    const good = base.goodById.get(entry.id);
    return good === undefined ? null : goodIcon(context, good, ROW_PICTURE_PX);
  }
  if (entry.kind === 'building') {
    const building = base.buildingById.get(entry.id);
    return building === undefined ? null : buildingPicture(context, building, ROW_PICTURE_PX);
  }
  if (entry.kind !== 'animal') return null;
  const image = document.createElement('img');
  image.className = 'kn-animal';
  image.alt = '';
  return art.animalPicture(image, Number(entry.id), ROW_PICTURE_PX) ? image : null;
}

/** The category rail, its list and the open entry; the page is rebuilt for each place the reader goes. */
export function renderEncyclopedia(context: KnowledgeContext, opened: EntryRef | null): HTMLElement {
  const text = messages().knowledge.entry;
  const place = opened === null ? null : placeOf(context.base, opened);
  let category = place?.category ?? DEFAULT_CATEGORY;
  const selected = place === null ? null : keyOf(place.entry);
  const compare = compareLabels();

  const list = element('div', 'kn-list');
  list.dataset.keepScroll = 'enc-list';
  const rail = element('nav', 'kn-rail');
  const items = ENTRY_CATEGORIES.map((id) => {
    const item = button('kn-rail__item');
    item.append(
      node('span', '', text.categories[id]),
      node('small', '', String(categoryRows(context.base, id).length)),
    );
    item.addEventListener('click', () => {
      category = id;
      paint();
    });
    return { id, item };
  });
  rail.append(...items.map(({ item }) => item));

  const paint = (): void => {
    for (const { id, item } of items) item.setAttribute('aria-current', String(id === category));
    const rows = [...categoryRows(context.base, category)].sort((a, b) => compare(a.name, b.name));
    list.replaceChildren(
      ...rows.map((row) => {
        const item = button('kn-row');
        item.dataset.go = keyOf(row.entry);
        item.classList.toggle('is-selected', keyOf(row.entry) === selected);
        const label = element('span', '');
        write(label, row.name);
        const picture = rowPicture(context, row);
        if (picture !== null) item.append(picture);
        item.append(label);
        return item;
      }),
    );
  };
  paint();

  const page = element('div', 'on-parchment kn-page');
  page.dataset.keepScroll = selected === null ? 'enc-entry' : `enc-${selected}`;
  page.append(place === null ? emptyEntry(text.empty) : renderEntry(context, place.entry));
  return node('div', 'kn-enc', rail, list, page);
}
