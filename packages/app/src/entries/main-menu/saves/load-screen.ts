import { IR_VERSION } from '@open-northland/data/ir-version';
import { GLYPH } from '../../../hud/dom/icons.js';
import { button } from '../../../hud/dom/parts/dom.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import type { LaunchEntry } from '../../../launch.js';
import { decodeSaveText, type SaveBytes } from '../../../view/runtime/save-load/codec.js';
import { downloadStoredSave } from '../../../view/runtime/save-load/controller.js';
import { evaluateSaveDocument } from '../../../view/runtime/save-load/evaluate.js';
import { type PickedSaveFile, pickSaveFile } from '../../../view/runtime/save-load/file-access.js';
import { storePendingLoad } from '../../../view/runtime/save-load/pending-store.js';
import { relaunchSearch } from '../../../view/runtime/save-load/relaunch.js';
import { targetSearch } from '../../../view/target-search.js';
import { node } from '../dom.js';
import type { MenuScreen, MountedScreen } from '../model.js';
import { screenHead } from '../screen-head.js';
import { menuSavesPanel } from './panel.js';

/** The main menu's load screen: the save store's slots, launched into their own worlds. */
export function loadScreen(open: (screen: MenuScreen) => void, launch: LaunchEntry): MountedScreen {
  const copy = messages().saveList;
  const errors = messages().hud.loadErrors;
  const section = node('section', 'main-menu__screen');

  const load = button('on-button on-button--primary', GLYPH.next);
  load.append(copy.load);
  load.disabled = true;
  const exportButton = button('on-button', GLYPH.download);
  exportButton.append(copy.export);
  exportButton.disabled = true;
  const fromFile = button('on-button', GLYPH.upload);
  fromFile.append(copy.fromFile);

  const panel = menuSavesPanel({
    emptyHint: copy.emptyLoadHint,
    onSelect: (slot) => {
      load.disabled = slot === null;
      exportButton.disabled = slot === null;
    },
    onActivate: () => loadSelected(),
  });
  const { run, store, browser } = panel;
  panel.leading.append(fromFile);
  panel.actions.append(exportButton, load);

  /** Set once a save is staged: the entry downloading behind the screen owns those bytes, and a
   *  second hand-off would swap them under it. */
  let handedOff = false;

  /** Validate, stage, and hand the document to the save's own entry; a returned string is the
   *  rejection to show. */
  const stageAndLaunch = async (contents: string, raw: SaveBytes): Promise<string | null> => {
    if (handedOff) return null;
    const evaluated = evaluateSaveDocument(contents);
    if (!evaluated.ok) return errors[evaluated.reason];
    // The entry boots on this build's content, which no other content version restores onto.
    if (evaluated.save.header.irVersion !== IR_VERSION) return errors.wrongContent;
    const search = relaunchSearch(evaluated.save.header);
    if (search === null) return errors.corrupt;
    try {
      await storePendingLoad(raw);
    } catch {
      return errors.storage;
    }
    handedOff = true;
    launch(targetSearch(search));
    return null;
  };

  function loadSelected(): void {
    run(async (progress) => {
      const slot = browser.sheet.selected();
      if (slot === null) return null;
      const bytes = await store.read(slot.id).catch(() => null);
      if (bytes === null) {
        // A slot that vanished under the screen must leave the list with its message.
        await panel.refresh();
        return errors.missing;
      }
      progress(copy.loading);
      let contents: string;
      try {
        contents = await decodeSaveText(bytes);
      } catch {
        return errors.corrupt;
      }
      return stageAndLaunch(contents, bytes);
    });
  }
  load.addEventListener('click', loadSelected);

  fromFile.addEventListener('click', () =>
    run(async (progress) => {
      let picked: PickedSaveFile | null;
      try {
        picked = await pickSaveFile();
      } catch {
        return errors.corrupt;
      }
      if (picked === null) return null;
      progress(copy.loading);
      return stageAndLaunch(picked.contents, picked.raw);
    }),
  );

  exportButton.addEventListener('click', () =>
    run(async () => {
      const slot = browser.sheet.selected();
      if (slot === null) return null;
      try {
        if ((await downloadStoredSave(store, slot.id)) === 'missing') return errors.missing;
      } catch {
        return copy.exportFailed;
      }
      return formatMessage(copy.exported, { name: slot.name });
    }),
  );

  section.append(screenHead('load', open), panel.element);
  void panel.refresh();
  return { element: section, dispose: panel.dispose };
}
