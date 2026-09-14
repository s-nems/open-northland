import { formatMessage, messages } from '../../i18n/index.js';
import { confirmDialog } from '../confirm-dialog.js';
import { flowRunner } from '../runtime/save-load/flow-runner.js';
import type { SaveSlotInfo } from '../runtime/save-load/store.js';
import { worldNameIndex } from '../runtime/save-load/world-names.js';
import {
  el,
  nextPaint,
  PANEL_WIDTH_STYLE,
  ROW_BACKGROUND,
  type SavePanelDeps,
  type SavePanelView,
  SELECTED_ROW_BACKGROUND,
  slotList,
  statusLine,
} from './parts.js';

export function buildLoadPanel(deps: SavePanelDeps): SavePanelView {
  const copy = messages().saveList;
  const hud = messages().hud;
  const panel = el('div', `${deps.panelStyle};${PANEL_WIDTH_STYLE}`);
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', copy.loadTitle);

  const title = el('h2', 'margin:0 0 6px;font:18px/1.2 ui-serif,Georgia,serif', copy.loadTitle);
  const status = statusLine();
  const run = flowRunner(status.set, copy.actionFailed);

  let selected: SaveSlotInfo | null = null;
  let selectedRow: HTMLButtonElement | null = null;
  /** Buttons meaningless without a selected row; disabled until one is picked. */
  const selectionActions: HTMLButtonElement[] = [];

  /** In-game loading restores into the running world only. A slot from elsewhere stays listed and
   *  selectable, since deleting and exporting it still work. */
  const foreign = (slot: SaveSlotInfo): boolean =>
    slot.mapId !== null && slot.mapId !== deps.saveLoad.worldToken;

  const list = slotList(deps.saveLoad, status.set, (slot, row) => {
    if (foreign(slot)) row.style.opacity = '0.55';
    row.addEventListener('click', () => {
      if (selectedRow !== null) selectedRow.style.background = ROW_BACKGROUND;
      selected = slot;
      selectedRow = row;
      row.style.background = SELECTED_ROW_BACKGROUND;
      for (const button of selectionActions) button.disabled = false;
      status.set(foreign(slot) ? hud.loadErrors.wrongWorld : null);
    });
    row.addEventListener('dblclick', () => loadSelected());
  });

  /** Only the newest refresh may draw: an earlier one resolving late would list slots the store has
   *  already moved past, with the selection cleared behind it. */
  let refreshes = 0;
  const refresh = async (): Promise<void> => {
    const mine = ++refreshes;
    selected = null;
    selectedRow = null;
    for (const button of selectionActions) button.disabled = true;
    const worldName = await worldNameIndex();
    if (mine !== refreshes) return;
    await list.refresh(worldName);
  };

  const loadSelected = (): void =>
    run(async (progress) => {
      if (selected === null) return null;
      const slot = selected;
      // Refused before the question, so the player never trades a running game for a refusal.
      if (foreign(slot)) return hud.loadErrors.wrongWorld;
      // Loading replaces the running session, so it asks like the other destructive actions.
      const confirmed = await confirmDialog({
        message: formatMessage(copy.loadConfirm, { name: slot.name }),
        confirmLabel: copy.load,
        cancelLabel: copy.cancel,
      });
      if (!confirmed) return null;
      progress(copy.loading);
      await nextPaint();
      const outcome = await deps.saveLoad.loadSave(slot.id);
      if (outcome.kind !== 'rejected') return null;
      // A slot that vanished under the panel must leave the list with its message.
      if (outcome.reason === 'missing') await refresh();
      return hud.loadErrors[outcome.reason];
    });

  const load = el('button', deps.buttonStyle, copy.load);
  load.type = 'button';
  load.disabled = true;
  load.addEventListener('click', loadSelected);
  selectionActions.push(load);

  const del = el('button', deps.buttonStyle, copy.del);
  del.type = 'button';
  del.disabled = true;
  selectionActions.push(del);
  del.addEventListener('click', () =>
    run(async () => {
      if (selected === null) return null;
      const slot = selected;
      const confirmed = await confirmDialog({
        message: formatMessage(copy.deleteConfirm, { name: slot.name }),
        confirmLabel: copy.del,
        cancelLabel: copy.cancel,
      });
      if (!confirmed) return null;
      try {
        await deps.saveLoad.deleteSave(slot.id);
      } catch {
        return copy.deleteFailed;
      }
      await refresh();
      return copy.deleted;
    }),
  );

  const fromFile = el('button', deps.buttonStyle, copy.fromFile);
  fromFile.type = 'button';
  fromFile.addEventListener('click', () =>
    run(async (progress) => {
      const outcome = await deps.saveLoad.loadFromFile();
      if (outcome.kind === 'loading') progress(copy.loading);
      return outcome.kind === 'rejected' ? hud.loadErrors[outcome.reason] : null;
    }),
  );

  const exportButton = el('button', deps.buttonStyle, copy.export);
  exportButton.type = 'button';
  exportButton.disabled = true;
  selectionActions.push(exportButton);
  exportButton.addEventListener('click', () =>
    run(async () => {
      if (selected === null) return null;
      const outcome = await deps.saveLoad.exportSave(selected.id);
      return outcome.kind === 'failed' ? copy.exportFailed : null;
    }),
  );

  const back = el('button', deps.buttonStyle, copy.back);
  back.type = 'button';
  back.addEventListener('click', deps.showMenu);

  const actions = el('div', 'display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end');
  actions.append(load, del, fromFile, exportButton, back);
  panel.append(title, list.box, actions, status.el);

  return {
    el: panel,
    open(): void {
      run.reset();
      status.set(null);
      void refresh();
    },
  };
}
