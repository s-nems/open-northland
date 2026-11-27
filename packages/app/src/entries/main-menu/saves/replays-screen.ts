import { IR_VERSION } from '@open-northland/data/ir-version';
import { SAVE_FORMAT_VERSION } from '@open-northland/sim';
import { GLYPH } from '../../../hud/dom/icons.js';
import { button } from '../../../hud/dom/parts/dom.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import type { LaunchEntry } from '../../../launch.js';
import { decodeSaveText, type SaveBytes } from '../../../view/runtime/save-load/codec.js';
import { downloadStoredSave } from '../../../view/runtime/save-load/controller.js';
import { storePendingReplay } from '../../../view/runtime/save-load/pending-store.js';
import type { ReplaySlotInfo } from '../../../view/runtime/save-load/replay-store.js';
import { browserReplayStore } from '../../../view/runtime/save-load/replay-store.js';
import type { SaveSlotInfo, SaveStore } from '../../../view/runtime/save-load/store.js';
import { targetSearch } from '../../../view/target-search.js';
import { node } from '../dom.js';
import type { MenuScreen, MountedScreen } from '../model.js';
import { screenHead } from '../screen-head.js';
import { menuSavesPanel } from './panel.js';

/** The main menu's replay screen: the replay store's recordings, played back on the map entry. */
export function replaysScreen(open: (screen: MenuScreen) => void, launch: LaunchEntry): MountedScreen {
  const copy = messages().saveList;
  const errors = messages().hud.loadErrors;
  const store = browserReplayStore();
  const section = node('section', 'main-menu__screen');

  const play = button('on-button on-button--primary', GLYPH.next);
  play.append(copy.replayPlay);
  play.disabled = true;
  const exportButton = button('on-button', GLYPH.download);
  exportButton.append(copy.export);
  exportButton.disabled = true;

  const panel = menuSavesPanel({
    store: replayStoreAsSaves(store),
    emptyHint: copy.emptyReplayHint,
    onSelect: (slot) => {
      play.disabled = slot === null;
      exportButton.disabled = slot === null;
    },
    onActivate: () => playSelected(),
  });
  const { run } = panel;
  panel.actions.append(exportButton, play);

  /** Set once a replay is staged: the entry downloading behind the screen owns those bytes, and a
   *  second hand-off would swap them under it. */
  let handedOff = false;

  const playSelected = (): void =>
    run(async (progress) => {
      const slot = panel.browser.sheet.selected();
      if (slot === null) return null;
      const bytes = await store.read(slot.id).catch(() => null);
      if (bytes === null) {
        await panel.refresh();
        return errors.missing;
      }
      progress(copy.replayPreparing);
      let text: string;
      try {
        text = await decodeSaveText(bytes);
      } catch {
        return copy.replayCorrupt;
      }
      // A build cannot reproduce a run its format or content moved under; refuse it before the boot
      // spends its time standing a world up.
      try {
        const parsed = JSON.parse(text) as {
          version?: unknown;
          formatVersion?: unknown;
          irVersion?: unknown;
        };
        if (parsed.version !== 1 || parsed.formatVersion !== SAVE_FORMAT_VERSION) return copy.replayCorrupt;
        if (parsed.irVersion !== IR_VERSION) return errors.wrongContent;
      } catch {
        return copy.replayCorrupt;
      }
      if (handedOff) return null;
      try {
        await storePendingReplay(bytes);
      } catch {
        return errors.storage;
      }
      handedOff = true;
      const mapId = slot.mapId ?? '';
      launch(targetSearch(mapId === '' ? 'map' : `map=${encodeURIComponent(mapId)}`));
      return null;
    });
  play.addEventListener('click', playSelected);

  exportButton.addEventListener('click', () =>
    run(async () => {
      const slot = panel.browser.sheet.selected();
      if (slot === null) return null;
      try {
        if ((await downloadStoredSave(panel.store, slot.id)) === 'missing') return errors.missing;
      } catch {
        return copy.exportFailed;
      }
      return formatMessage(copy.exported, { name: slot.name });
    }),
  );

  section.append(screenHead('replays', open), panel.element);
  void panel.refresh();
  return { element: section, dispose: panel.dispose };
}

/** A replay store read through the save slot's shape, so the menu's slot sheet lists, searches and
 *  deletes recordings like saves. Nothing writes a replay through it: captures name their own slots. */
function replayStoreAsSaves(store: {
  list(): Promise<readonly ReplaySlotInfo[]>;
  read(id: string): Promise<SaveBytes | null>;
  remove(id: string): Promise<void>;
}): SaveStore {
  return {
    list: async () =>
      (await store.list()).map(
        (slot): SaveSlotInfo => ({
          id: slot.id,
          name: slot.name,
          mapId: slot.mapId,
          tick: slot.untilTick,
          entry: null,
          savedAt: slot.savedAt,
          seed: slot.seed,
          thumbnail: null,
        }),
      ),
    read: (id) => store.read(id),
    write: async () => undefined,
    remove: (id) => store.remove(id),
  };
}
