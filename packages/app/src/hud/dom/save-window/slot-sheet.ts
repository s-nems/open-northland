import { bcp47Tag, formatMessage, messages, pluralForm } from '../../../i18n/index.js';
import { formatPlaytime, formatSavedAgo, formatSavedAt } from '../../../view/runtime/save-load/list-model.js';
import {
  type Playthrough,
  playthroughsOf,
  type RunningWorld,
} from '../../../view/runtime/save-load/playthroughs.js';
import type { SaveSlotInfo } from '../../../view/runtime/save-load/store.js';
import type { WorldNameOf } from '../../../view/runtime/save-load/world-names.js';
import { GLYPH } from '../icons.js';
import { button, element, setTip } from '../parts/dom.js';
import { foldText } from '../parts/name-search.js';

export interface SlotSheetOptions {
  /** A save of another world than the running one, whose game is tagged so. */
  readonly otherWorld?: (slot: SaveSlotInfo) => boolean;
  /** A tag naming why the newest slot of a game cannot play here, if it cannot; null, no tag. */
  readonly unplayableTag?: (slot: SaveSlotInfo) => string | null;
  /** The game running now, whose saves come first and open. */
  readonly running: RunningWorld | null;
  readonly emptyHint: string;
  readonly onSelect: (slot: SaveSlotInfo | null) => void;
  /** Double click or Enter on a row. */
  readonly onActivate?: (slot: SaveSlotInfo) => void;
  readonly onDelete: (slot: SaveSlotInfo) => void;
  /** The sheet's lifetime: its pictures are released when it ends. */
  readonly signal: AbortSignal;
}

export interface SlotSheet {
  readonly el: HTMLElement;
  /** Draw these slots, keeping the selection by id when it is still listed. */
  show(slots: readonly SaveSlotInfo[], worldName: WorldNameOf): void;
  /** The store could not be read: the list says so instead of looking empty. */
  showFailure(text: string): void;
  filter(query: string): void;
  /** Select a row, opening its game; a row the search hides waits until the search shows it. */
  select(id: string | null): void;
  selected(): SaveSlotInfo | null;
  /** A selection is held, shown or waiting behind a search or a closed game. */
  holdsSelection(): boolean;
  /** Focus the selected row, or the first entry. */
  focus(): boolean;
}

interface Group {
  readonly playthrough: Playthrough;
  readonly item: HTMLLIElement;
  readonly head: HTMLButtonElement;
  readonly rows: HTMLUListElement;
}

interface Row {
  readonly slot: SaveSlotInfo;
  readonly group: Group;
  readonly item: HTMLLIElement;
  readonly pick: HTMLButtonElement;
  readonly del: HTMLButtonElement;
  /** Name and map, folded for the search. */
  readonly haystack: string;
}

function textElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text: string,
): HTMLElementTagNameMap[K] {
  const node = element(tag, className);
  node.textContent = text;
  return node;
}

/** The saves on a parchment sheet, one collapsible group per game: newest first, one selected row, a
 *  bin on the row it belongs to. */
export function createSlotSheet(opts: SlotSheetOptions): SlotSheet {
  const copy = messages().saveList;
  const el = element('div', 'on-parchment on-saves__sheet');
  const list = element('ul', 'on-saves__list');
  list.setAttribute('aria-label', copy.listLabel);
  const empty = element('div', 'on-saves__empty');
  empty.setAttribute('role', 'status');
  el.append(list, empty);

  let groups: Group[] = [];
  let rows: Row[] = [];
  let current: Row | null = null;
  /** The selection a search or a closed group hid, picked again once it shows. */
  let parked: Row | null = null;
  let query = '';
  /** Games the player opened, by playthrough key; kept across redraws while the window lives. */
  const open = new Set<string>();
  let opened = false;
  /** Picture URLs of the drawn rows, released when the rows are replaced. */
  let pictures: string[] = [];

  const searching = (): boolean => foldText(query).trim() !== '';
  const matches = (row: Row): boolean => !row.item.hidden;
  const expanded = (group: Group): boolean => searching() || open.has(group.playthrough.key);
  const shows = (row: Row): boolean => matches(row) && expanded(row.group);
  /** The keyboard's walk: each shown game's head, then its shown rows. */
  const entries = (): HTMLButtonElement[] =>
    groups
      .filter((group) => !group.item.hidden)
      .flatMap((group) => [
        group.head,
        ...rows.filter((row) => row.group === group && shows(row)).map((row) => row.pick),
      ]);

  const mark = (): void => {
    const walk = entries();
    // Roving tab stop: the selected row, or the first entry, is the list's only stop.
    const stop = current !== null && shows(current) ? current.pick : (walk[0] ?? null);
    for (const group of groups) {
      group.head.setAttribute('aria-expanded', String(expanded(group)));
      group.rows.hidden = !expanded(group);
      group.head.tabIndex = group.head === stop ? 0 : -1;
    }
    for (const row of rows) {
      const on = row === current;
      row.item.classList.toggle('is-selected', on);
      row.pick.setAttribute('aria-pressed', String(on));
      row.pick.tabIndex = row.pick === stop ? 0 : -1;
      row.del.tabIndex = on ? 0 : -1;
    }
  };

  const choose = (row: Row | null): void => {
    if (row !== null) parked = null;
    if (row === current) return;
    current = row;
    mark();
    opts.onSelect(row?.slot ?? null);
  };

  const showEmpty = (title: string, hint: string): void => {
    empty.replaceChildren(textElement('strong', '', title), textElement('span', '', hint));
    empty.hidden = false;
  };

  /** Settle the selection and the list after a search, a redraw or a game opening or closing. */
  const sync = (): void => {
    const needle = foldText(query).trim();
    for (const row of rows) row.item.hidden = needle !== '' && !row.haystack.includes(needle);
    for (const group of groups) group.item.hidden = !rows.some((row) => row.group === group && matches(row));
    if (current !== null && !shows(current)) {
      const hidden = current;
      choose(null);
      parked = hidden;
    } else if (current === null && parked !== null && shows(parked)) choose(parked);
    const shown = rows.filter(matches).length;
    if (rows.length === 0) showEmpty(copy.empty, opts.emptyHint);
    else if (shown === 0) showEmpty(formatMessage(copy.noMatch, { query: query.trim() }), '');
    else empty.hidden = true;
    mark();
  };

  const toggle = (group: Group, opening: boolean): void => {
    if (searching()) return;
    if (opening) open.add(group.playthrough.key);
    else open.delete(group.playthrough.key);
    sync();
  };

  const groupOf = (playthrough: Playthrough, worldName: WorldNameOf, now: number): Group => {
    const tag = bcp47Tag();
    const item = element('li', 'on-saves__group');
    const head = button('on-saves__group-head', GLYPH.down);
    const title = element('span', 'on-saves__group-title');
    title.append(textElement('strong', 'on-saves__group-name', worldName(playthrough.mapId) ?? '-'));
    if (playthrough.ordinal !== null) {
      const ordinal = formatMessage(copy.playthrough, { n: playthrough.ordinal });
      title.append(textElement('span', 'on-saves__group-ordinal', ordinal));
    }
    if (playthrough.current) title.append(textElement('span', 'on-saves__tag is-current', copy.currentGame));
    const newest = playthrough.slots[0];
    if (newest !== undefined && opts.otherWorld?.(newest) === true)
      title.append(textElement('span', 'on-saves__tag', copy.otherWorld));
    const unplayable = newest !== undefined ? opts.unplayableTag?.(newest) : null;
    if (unplayable !== undefined && unplayable !== null)
      title.append(textElement('span', 'on-saves__tag', unplayable));
    const count = playthrough.slots.length;
    const summary = [
      formatMessage(pluralForm(count, copy.saveCount, tag), { count }),
      formatSavedAgo(newest?.savedAt ?? null, now, tag),
    ].join(' · ');
    head.append(title, textElement('span', 'on-saves__group-meta', summary));
    const rowList = element('ul', 'on-saves__rows');
    item.append(head, rowList);
    const group: Group = { playthrough, item, head, rows: rowList };
    head.addEventListener('click', () => toggle(group, !open.has(playthrough.key)));
    return group;
  };

  const rowOf = (slot: SaveSlotInfo, group: Group, worldName: WorldNameOf, now: number): Row => {
    const tag = bcp47Tag();
    const item = element('li', 'on-saves__row');
    const pick = button('on-saves__pick');
    const thumb = element('span', 'on-saves__thumb');
    if (slot.thumbnail !== null) {
      const url = URL.createObjectURL(slot.thumbnail);
      pictures.push(url);
      const image = element('img', '');
      image.alt = '';
      image.decoding = 'async';
      image.loading = 'lazy';
      image.src = url;
      thumb.append(image);
    } else thumb.innerHTML = GLYPH.papers;
    const playtime = slot.tick !== null ? formatPlaytime(slot.tick) : '-';
    const title = element('span', 'on-saves__title');
    const sub =
      slot.version === undefined || slot.version === null
        ? formatMessage(copy.playtime, { time: playtime })
        : `${formatMessage(copy.playtime, { time: playtime })} · ${slot.version}`;
    title.append(
      textElement('strong', 'on-saves__name', slot.name),
      textElement('span', 'on-saves__sub', sub),
    );
    const when = textElement('span', 'on-saves__when', formatSavedAgo(slot.savedAt, now, tag));
    setTip(when, formatSavedAt(slot.savedAt, tag));
    pick.append(thumb, title, when);
    const del = button('on-saves__del', GLYPH.bin);
    const delLabel = formatMessage(copy.deleteNamed, { name: slot.name });
    del.setAttribute('aria-label', delLabel);
    setTip(del, delLabel);
    item.append(pick, del);
    group.rows.append(item);
    const haystack = foldText(`${slot.name} ${worldName(slot.mapId) ?? ''}`);
    const row: Row = { slot, group, item, pick, del, haystack };
    pick.addEventListener('click', () => choose(row));
    pick.addEventListener('dblclick', () => opts.onActivate?.(slot));
    // The confirmation names the save, so the bin leaves the selection and what it filled alone.
    del.addEventListener('click', () => opts.onDelete(slot));
    return row;
  };

  const focusEntry = (node: HTMLButtonElement | undefined): void => {
    if (node === undefined) return;
    const row = rows.find((candidate) => candidate.pick === node);
    if (row !== undefined) choose(row);
    node.focus();
    node.scrollIntoView({ block: 'nearest' });
  };

  list.addEventListener('keydown', (event) => {
    const walk = entries();
    const group = groups.find((candidate) => candidate.head === event.target);
    // A row's bin walks and deletes as its row does.
    const row = rows.find((candidate) => candidate.pick === event.target || candidate.del === event.target);
    const from = row?.pick ?? group?.head;
    const at = from === undefined ? -1 : walk.indexOf(from);
    if (event.key === 'ArrowDown') focusEntry(walk[Math.min(at + 1, walk.length - 1)]);
    else if (event.key === 'ArrowUp') focusEntry(walk[Math.max(at - 1, 0)]);
    else if (event.key === 'Home') focusEntry(walk[0]);
    else if (event.key === 'End') focusEntry(walk.at(-1));
    else if (event.key === 'ArrowRight' && group !== undefined) toggle(group, true);
    else if (event.key === 'ArrowLeft' && group !== undefined) toggle(group, false);
    else if (event.key === 'ArrowLeft' && row !== undefined) focusEntry(row.group.head);
    else if (event.key === 'Enter' && row !== undefined && event.target === row.pick)
      opts.onActivate?.(row.slot);
    else if (event.key === 'Delete' && row !== undefined) opts.onDelete(row.slot);
    else return;
    event.preventDefault();
  });

  const release = (): void => {
    for (const url of pictures) URL.revokeObjectURL(url);
    pictures = [];
  };

  opts.signal.addEventListener('abort', release, { once: true });

  return {
    el,
    show(slots, worldName) {
      const before = current;
      const keep = (current ?? parked)?.slot.id ?? null;
      const now = Date.now();
      release();
      groups = playthroughsOf(slots, opts.running).map((playthrough) => groupOf(playthrough, worldName, now));
      rows = groups.flatMap((group) =>
        group.playthrough.slots.map((slot) => rowOf(slot, group, worldName, now)),
      );
      list.replaceChildren(...groups.map((group) => group.item));
      // The first list opens the game running now, or else the newest one.
      if (!opened && groups[0] !== undefined) {
        opened = true;
        open.add(groups[0].playthrough.key);
      }
      // The kept row waits as parked; the settle picks it again only if the player can see it.
      current = null;
      parked = rows.find((row) => row.slot.id === keep) ?? null;
      sync();
      if (before !== null && current === null) opts.onSelect(null);
    },
    showFailure(text) {
      release();
      groups = [];
      rows = [];
      list.replaceChildren();
      if (current !== null) choose(null);
      showEmpty(text, '');
    },
    filter(next) {
      query = next;
      sync();
    },
    select(id) {
      const row = rows.find((candidate) => candidate.slot.id === id) ?? null;
      parked = null;
      if (row === null) {
        choose(null);
        return;
      }
      open.add(row.group.playthrough.key);
      if (!matches(row)) {
        choose(null);
        parked = row;
        sync();
        return;
      }
      choose(row);
      sync();
      row.item.scrollIntoView({ block: 'nearest' });
    },
    selected: () => current?.slot ?? null,
    holdsSelection: () => current !== null || parked !== null,
    focus() {
      const target = current !== null && shows(current) ? current.pick : entries()[0];
      target?.focus();
      return target !== undefined;
    },
  };
}
