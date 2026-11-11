import { formatMessage, messages } from '../../../i18n/index.js';
import { flowRunner } from '../../../view/runtime/save-load/flow-runner.js';
import { GLYPH } from '../icons.js';
import { button } from '../parts/dom.js';
import { exportAction, removeSlot } from './actions.js';
import { createSaveBrowser } from './browser.js';
import { type MenuPageView, nextPaint, type SaveWindowDeps, savesFrame } from './frame.js';

/** Pick a stored save, or a file, and restore it in place of the running game, whatever its world. */
export function createLoadWindow(deps: SaveWindowDeps): MenuPageView {
  const copy = messages().saveList;
  const hud = messages().hud;
  const frame = savesFrame(deps, copy.loadTitle, 'on-saves--load');
  const run = flowRunner(frame.status, copy.actionFailed);

  const load = button('on-button on-button--primary', GLYPH.next);
  load.append(copy.load);
  load.disabled = true;

  const exportButton = exportAction(deps, () => sheet.selected(), run);
  const browser = createSaveBrowser({
    list: () => deps.saveLoad.listSaves(),
    otherWorld: (slot) => slot.mapId !== null && slot.mapId !== deps.saveLoad.worldToken,
    running: { mapId: deps.saveLoad.worldToken, seed: deps.saveLoad.worldSeed },
    signal: deps.signal,
    emptyHint: copy.emptyLoadHint,
    onSelect: (slot) => {
      load.disabled = slot === null;
      exportButton.disabled = slot === null;
    },
    onActivate: () => loadSelected(),
    onDelete: (slot) => removeSlot(deps, slot, run, refresh),
  });
  const { sheet } = browser;
  frame.window.body.append(browser.search, sheet.el);

  async function refresh(): Promise<void> {
    if ((await browser.refresh()) === null) return;
    // A tip shown on a redrawn row would outlive it.
    frame.hideTips();
    if (!frame.window.element.contains(document.activeElement) && !sheet.focus()) load.focus();
  }

  function loadSelected(): void {
    run(async (progress) => {
      const slot = sheet.selected();
      if (slot === null) return null;
      // Loading replaces the running session, so it asks like the other destructive actions.
      const confirmed = await deps.confirm({
        title: copy.loadTitle,
        message: formatMessage(copy.loadConfirm, { name: slot.name }),
        cancel: copy.cancel,
        confirm: copy.load,
      });
      if (!confirmed) return null;
      progress(copy.loading);
      await nextPaint();
      const outcome = await deps.saveLoad.loadSave(slot.id);
      if (outcome.kind !== 'rejected') return null;
      // A slot that vanished under the window must leave the list with its message.
      if (outcome.reason === 'missing') await refresh();
      return hud.loadErrors[outcome.reason];
    });
  }
  load.addEventListener('click', loadSelected);

  const fromFile = button('on-button', GLYPH.upload);
  fromFile.append(copy.fromFile);
  fromFile.addEventListener('click', () =>
    run(async (progress) => {
      const outcome = await deps.saveLoad.loadFromFile();
      if (outcome.kind === 'loading') progress(copy.loading);
      return outcome.kind === 'rejected' ? hud.loadErrors[outcome.reason] : null;
    }),
  );
  frame.leading.append(fromFile);
  frame.actions.append(exportButton, load);

  return {
    el: frame.window.element,
    open(): void {
      run.reset();
      frame.status(null);
      browser.reset();
      frame.window.open();
      void refresh();
    },
    close(): void {
      frame.hideTips();
      frame.window.close();
    },
  };
}
