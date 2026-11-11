import { messages } from '../../../i18n/index.js';
import { playthroughsOf } from '../../../view/runtime/save-load/playthroughs.js';
import type { SaveSlotInfo } from '../../../view/runtime/save-load/store.js';
import { worldNameIndex } from '../../../view/runtime/save-load/world-names.js';
import { GLYPH } from '../icons.js';
import { element } from '../parts/dom.js';
import { quietTextField } from '../parts/text-field.js';
import { createSlotSheet, type SlotSheet, type SlotSheetOptions } from './slot-sheet.js';

export interface SaveBrowserOptions extends SlotSheetOptions {
  /** The slots to list, newest first. */
  readonly list: () => Promise<readonly SaveSlotInfo[]>;
}

/** A searchable list of saves to load from: the in-game window and the menu's screens. */
export interface SaveBrowser {
  /** The search field, placed over the sheet by its owner. */
  readonly search: HTMLElement;
  readonly sheet: SlotSheet;
  /** List the slots again; resolves the slots this call drew, or null when a newer call superseded
   *  it or the list failed. A list without a selection selects the newest save of the running game,
   *  or else the newest of all, so Enter continues from it. */
  refresh(): Promise<readonly SaveSlotInfo[] | null>;
  /** Clear the search and the selection, as a reopened window starts. */
  reset(): void;
}

export function createSaveBrowser(opts: SaveBrowserOptions): SaveBrowser {
  const copy = messages().saveList;
  const search = element('label', 'on-saves__field on-saves__search', GLYPH.search);
  const query = quietTextField(element('input', ''));
  query.type = 'search';
  query.placeholder = copy.searchPlaceholder;
  query.setAttribute('aria-label', copy.searchPlaceholder);
  search.append(query);
  const sheet = createSlotSheet(opts);
  query.addEventListener('input', () => sheet.filter(query.value));

  /** Only the newest refresh of a live sheet may draw: an earlier one resolving late would list slots
   *  the store has already moved past, and one resolving after the sheet ended would make pictures
   *  nothing releases. */
  let refreshes = 0;
  const stale = (mine: number): boolean => mine !== refreshes || opts.signal.aborted;
  return {
    search,
    sheet,
    async refresh() {
      const mine = ++refreshes;
      const worldName = await worldNameIndex();
      if (stale(mine)) return null;
      let slots: readonly SaveSlotInfo[];
      try {
        slots = await opts.list();
      } catch {
        if (!stale(mine)) sheet.showFailure(copy.listFailed);
        return null;
      }
      if (stale(mine)) return null;
      sheet.show(slots, worldName);
      if (!sheet.holdsSelection()) sheet.select(playthroughsOf(slots, opts.running)[0]?.slots[0]?.id ?? null);
      return slots;
    },
    reset() {
      query.value = '';
      sheet.filter('');
      sheet.select(null);
    },
  };
}
