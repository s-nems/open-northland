import { formatMessage, messages } from '../../i18n/index.js';
import { confirmDialog } from '../confirm-dialog.js';
import { flowRunner } from '../runtime/save-load/flow-runner.js';
import { autoSaveName, MAX_SAVE_NAME_LENGTH, sanitizedSaveName } from '../runtime/save-load/list-model.js';
import { worldNameIndex } from '../runtime/save-load/world-names.js';
import {
  el,
  nextPaint,
  PANEL_WIDTH_STYLE,
  type SavePanelDeps,
  type SavePanelView,
  slotList,
  statusLine,
} from './parts.js';

export function buildSavePanel(deps: SavePanelDeps): SavePanelView {
  const copy = messages().saveList;
  const hud = messages().hud;
  const panel = el('div', `${deps.panelStyle};${PANEL_WIDTH_STYLE}`);
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', copy.saveTitle);

  const title = el('h2', 'margin:0 0 6px;font:18px/1.2 ui-serif,Georgia,serif', copy.saveTitle);
  const status = statusLine();
  const run = flowRunner(status.set, copy.actionFailed);

  const nameLabel = el('label', 'display:flex;gap:8px;align-items:center');
  nameLabel.append(el('span', '', copy.nameLabel));
  const nameInput = el(
    'input',
    'flex:1;padding:6px 8px;background:rgba(20,16,12,0.9);color:inherit;font:inherit;border:1px solid rgba(138,116,74,0.7);border-radius:4px',
  );
  nameInput.type = 'text';
  nameInput.maxLength = MAX_SAVE_NAME_LENGTH;
  nameLabel.append(nameInput);

  /** Names on the list at the last refresh, or null while the store's slots are unknown: saving
   *  then could overwrite one of them without asking. */
  let existing: readonly string[] | null = null;

  const list = slotList(deps.saveLoad, status.set, (slot, row) => {
    row.addEventListener('click', () => {
      nameInput.value = slot.name;
      status.set(null);
    });
  });

  const save = el('button', deps.buttonStyle, copy.save);
  save.type = 'button';
  save.disabled = true;

  /** Only the newest refresh may publish: an earlier one resolving late would put the pre-save list
   *  back, and the overwrite guard reads it. */
  let refreshes = 0;
  const refresh = async (): Promise<void> => {
    const mine = ++refreshes;
    const worldName = await worldNameIndex();
    if (mine !== refreshes) return;
    const slots = await list.refresh(worldName);
    if (mine !== refreshes) return;
    existing = slots?.map((slot) => slot.name) ?? null;
    save.disabled = existing === null;
    if (existing !== null && nameInput.value === '') {
      const world = worldName(deps.saveLoad.worldToken);
      // `formatMessage` leaves the unknown `{n}` in place for `autoSaveName` to number.
      const template = world !== null ? formatMessage(copy.autoNameMap, { map: world }) : copy.autoName;
      nameInput.value = autoSaveName(template, existing);
      nameInput.select();
    }
  };

  save.addEventListener('click', () =>
    run(async (progress) => {
      const taken = existing;
      if (taken === null) return copy.listFailed;
      const name = sanitizedSaveName(nameInput.value);
      if (name === null) return copy.invalidName;
      if (taken.includes(name)) {
        const confirmed = await confirmDialog({
          message: formatMessage(copy.overwriteConfirm, { name }),
          confirmLabel: copy.overwrite,
          cancelLabel: copy.cancel,
          // The player asked to save; the question only stands between them and that.
          defaultChoice: 'confirm',
        });
        if (!confirmed) return copy.notSaved;
      }
      // Exporting and compressing a real map's world blocks the frame, so say so before it starts.
      progress(copy.saving);
      await nextPaint();
      const outcome = await deps.saveLoad.saveGame(name);
      if (outcome.kind !== 'saved') return hud.saveFailed;
      await refresh();
      return hud.gameSaved;
    }),
  );
  nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') save.click();
  });

  const back = el('button', deps.buttonStyle, copy.back);
  back.type = 'button';
  back.addEventListener('click', deps.showMenu);

  const actions = el('div', 'display:flex;gap:8px;justify-content:flex-end');
  actions.append(save, back);
  panel.append(title, nameLabel, list.box, actions, status.el);

  return {
    el: panel,
    open(): void {
      run.reset();
      status.set(null);
      nameInput.focus();
      nameInput.select();
      void refresh();
    },
  };
}
