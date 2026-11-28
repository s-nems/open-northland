import { IR_VERSION } from '@open-northland/data/ir-version';
import { CLIENT_BUILD, GAME_VERSION } from '../../../build-version.js';
import { GLYPH } from '../../../hud/dom/icons.js';
import { button } from '../../../hud/dom/parts/dom.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import type { LaunchEntry } from '../../../launch.js';
import { decodeSaveText, type SaveBytes } from '../../../view/runtime/save-load/codec.js';
import { downloadStoredSave } from '../../../view/runtime/save-load/controller.js';
import { storePendingReplay } from '../../../view/runtime/save-load/pending-store.js';
import {
  parseReplayDocument,
  type ReplayDocument,
  replayRefusalOn,
  replaySlotKeyOf,
  replaySlotNameOf,
} from '../../../view/runtime/save-load/replay.js';
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
  const importButton = button('on-button', GLYPH.upload);
  importButton.append(copy.import);

  const panel = menuSavesPanel({
    store: replayStoreAsSaves(store),
    emptyHint: copy.emptyReplayHint,
    onSelect: (slot) => {
      // A replay another build recorded never plays: the button names why rather than starting a boot
      // that refuses itself.
      play.disabled = slot === null || slot.clientBuild !== CLIENT_BUILD;
      exportButton.disabled = slot === null;
    },
    onActivate: () => playSelected(),
    unplayableTag: (slot) =>
      slot.clientBuild === CLIENT_BUILD || slot.version === null || slot.version === undefined
        ? null
        : formatMessage(copy.replayOtherVersion, { version: slot.version }),
  });
  const { run } = panel;
  panel.actions.append(importButton, exportButton, play);

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
      // A build cannot reproduce a run its build or content moved under; the shared header check
      // refuses it before the boot spends its time standing a world up.
      let document: ReplayDocument;
      try {
        document = parseReplayDocument(text);
      } catch {
        return copy.replayCorrupt;
      }
      if (
        replayRefusalOn(document, {
          irVersion: IR_VERSION,
          clientBuild: CLIENT_BUILD,
          gameVersion: GAME_VERSION,
        }) !== null
      ) {
        return formatMessage(copy.replayOtherVersion, { version: document.identity.gameVersion });
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

  // A picked file is untrusted: the whole document parses strict before anything of it is stored,
  // and what parses stands or falls in the list like any recorded one.
  importButton.addEventListener('click', () =>
    run(async () => {
      const file = await pickReplayFile();
      if (file === null) return null;
      let text: string;
      try {
        text = await decodeSaveText(file.bytes);
        const document = parseReplayDocument(text);
        const name = replaySlotNameOf(
          document.descriptor.world.kind === 'map' ? document.descriptor.world.mapId : '',
          document.startedAt,
        );
        await store.write(replaySlotKeyOf(document.startedAt, document.descriptor.seed), file.bytes, {
          name,
          mapId: document.descriptor.world.kind === 'map' ? document.descriptor.world.mapId : '',
          untilTick: document.untilTick,
          seed: document.descriptor.seed,
          savedAt: document.savedAt,
          clientBuild: document.identity.clientBuild,
          gameVersion: document.identity.gameVersion,
        });
      } catch {
        return copy.replayCorrupt;
      }
      await panel.refresh();
      return formatMessage(copy.imported, { name: file.name });
    }),
  );

  section.append(screenHead('replays', open), panel.element);
  void panel.refresh();
  return { element: section, dispose: panel.dispose };
}

/** A replay file off the player's disk, as the picker read it. */
async function pickReplayFile(): Promise<{ readonly name: string; readonly bytes: SaveBytes } | null> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.gz,application/gzip,application/json';
  input.style.display = 'none';
  document.body.append(input);
  try {
    const picked = await new Promise<File | null>((resolve) => {
      input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
      input.addEventListener('cancel', () => resolve(null), { once: true });
      input.click();
    });
    if (picked === null) return null;
    return {
      name: picked.name.replace(/\.(json\.gz|json|gz)$/, ''),
      bytes: new Uint8Array(await picked.arrayBuffer()),
    };
  } finally {
    input.remove();
  }
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
          version: slot.gameVersion,
          clientBuild: slot.clientBuild,
        }),
      ),
    read: (id) => store.read(id),
    write: async () => undefined,
    remove: (id) => store.remove(id),
  };
}
