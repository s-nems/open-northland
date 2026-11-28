import { formatMessage, messages } from '../../../i18n/index.js';
import type { GameSettingsRuntime } from '../../../view/runtime/game-settings.js';
import { flowRunner } from '../../../view/runtime/save-load/flow-runner.js';
import {
  autoSaveName,
  MAX_SAVE_NAME_LENGTH,
  sanitizedSaveName,
} from '../../../view/runtime/save-load/list-model.js';
import type { SaveSlotInfo } from '../../../view/runtime/save-load/store.js';
import { worldNameIndex } from '../../../view/runtime/save-load/world-names.js';
import { AUTOSAVE_COUNTS, type AutosaveMinutes } from '../../../view/settings/store.js';
import { GLYPH } from '../icons.js';
import { button, element, setTip } from '../parts/dom.js';
import { quietTextField } from '../parts/text-field.js';
import { exportAction, removeSlot } from './actions.js';
import { type MenuPageView, nextPaint, type SaveWindowDeps, savesFrame } from './frame.js';
import { createSlotSheet } from './slot-sheet.js';

/** Name a save, write it, and hand the written file out at once if the player wants a copy. */
export function createSaveWindow(
  deps: SaveWindowDeps & { readonly settings: Pick<GameSettingsRuntime, 'current' | 'update'> },
): MenuPageView {
  const copy = messages().saveList;
  const hud = messages().hud;
  const frame = savesFrame(deps, copy.saveTitle, 'on-saves--save');
  const run = flowRunner(frame.status, copy.actionFailed);

  const autosave = element('div', 'on-saves__autosave');
  const autoLabel = element('span', 'on-saves__label');
  autoLabel.textContent = copy.autosave;
  autoLabel.id = 'on-saves-autosave-label';
  autosave.setAttribute('role', 'group');
  autosave.setAttribute('aria-labelledby', autoLabel.id);
  const autoOptions = element('div', 'on-saves__auto-options');
  const choices: readonly AutosaveMinutes[] = [0, 5, 10, 15, 30];
  const autoButtons = new Map<AutosaveMinutes, HTMLButtonElement>();
  const countButtons = new Map<number, HTMLButtonElement>();
  const press = (choice: HTMLButtonElement, selected: boolean): void => {
    choice.setAttribute('aria-pressed', String(selected));
    choice.classList.toggle('on-button--primary', selected);
  };
  const refreshAutosave = (): void => {
    const { autosaveMinutes, autosaveCount } = deps.settings.current();
    for (const [minutes, choice] of autoButtons) press(choice, minutes === autosaveMinutes);
    for (const [count, choice] of countButtons) press(choice, count === autosaveCount);
  };
  for (const minutes of choices) {
    const choice = button('on-button', '');
    choice.textContent = minutes === 0 ? copy.autosaveOff : formatMessage(copy.autosaveEvery, { n: minutes });
    setTip(choice, copy.autosaveHint);
    choice.addEventListener('click', () => {
      void deps.settings.update({ autosaveMinutes: minutes }).then(refreshAutosave);
    });
    autoButtons.set(minutes, choice);
    autoOptions.append(choice);
  }
  const countLabel = element('span', 'on-saves__label');
  countLabel.textContent = copy.autosaveKeep;
  const countOptions = element('div', 'on-saves__auto-options on-saves__auto-count');
  for (const count of AUTOSAVE_COUNTS) {
    const choice = button('on-button', '');
    choice.textContent = String(count);
    setTip(choice, copy.autosaveKeepHint);
    choice.addEventListener('click', () => {
      void deps.settings.update({ autosaveCount: count }).then(refreshAutosave);
    });
    countButtons.set(count, choice);
    countOptions.append(choice);
  }
  autosave.append(autoLabel, autoOptions, countLabel, countOptions);

  const nameId = 'on-saves-name';
  const label = element('label', 'on-saves__label');
  label.htmlFor = nameId;
  label.textContent = copy.nameLabel;
  const field = element('div', 'on-saves__field');
  const input = quietTextField(element('input', ''));
  input.id = nameId;
  input.type = 'text';
  input.maxLength = MAX_SAVE_NAME_LENGTH;
  field.innerHTML = GLYPH.pen;
  field.append(input);
  const save = button('on-button on-button--primary on-saves__save', GLYPH.check);
  save.append(copy.save);
  save.disabled = true;
  const nameRow = element('div', 'on-saves__name-row');
  nameRow.append(field, save);
  const hint = element('p', 'on-saves__hint');
  hint.id = 'on-saves-name-hint';
  input.setAttribute('aria-describedby', hint.id);

  /** The list at the last refresh, or null while the store's slots are unknown: saving then could
   *  overwrite one of them without asking. */
  let listed: readonly SaveSlotInfo[] | null = null;
  const slotNamed = (raw: string): SaveSlotInfo | null => {
    const name = sanitizedSaveName(raw);
    const selected = sheet.selected();
    if (selected !== null && selected.name === name) return selected;
    return listed?.find((slot) => slot.id === name) ?? null;
  };
  const showHint = (): void => {
    const overwrites = slotNamed(input.value) !== null;
    hint.textContent = overwrites ? copy.overwriteHint : '';
    hint.classList.toggle('is-warning', overwrites);
  };

  const exportButton = exportAction(deps, () => sheet.selected(), run);
  const sheet = createSlotSheet({
    running: { mapId: deps.saveLoad.worldToken, seed: deps.saveLoad.worldSeed },
    signal: deps.signal,
    emptyHint: copy.emptySaveHint,
    onSelect: (slot: SaveSlotInfo | null) => {
      exportButton.disabled = slot === null;
      if (slot === null) return;
      if (sanitizedSaveName(input.value) !== slot.name) input.value = slot.name;
      showHint();
    },
    onDelete: (slot) =>
      removeSlot(deps, slot, run, async () => {
        // A field still naming the deleted save would quietly write it back; offer a fresh name.
        if (sanitizedSaveName(input.value) === slot.name) input.value = '';
        await refresh();
      }),
  });
  const note = element('p', 'on-parchment__note');
  note.textContent = copy.existing;
  sheet.el.prepend(note);
  frame.window.body.append(label, nameRow, hint, sheet.el);
  frame.leading.after(autosave);
  frame.actions.append(exportButton);

  /** Only the newest refresh may publish: an earlier one resolving late would put the pre-save list
   *  back, and the overwrite guard reads it. */
  let refreshes = 0;
  async function refresh(selectName: string | null = null): Promise<void> {
    const mine = ++refreshes;
    const worldName = await worldNameIndex();
    if (mine !== refreshes) return;
    let slots: readonly SaveSlotInfo[];
    try {
      slots = await deps.saveLoad.listSaves();
    } catch {
      if (mine !== refreshes) return;
      listed = null;
      save.disabled = true;
      sheet.showFailure(copy.listFailed);
      return;
    }
    if (mine !== refreshes) return;
    listed = slots;
    save.disabled = false;
    frame.hideTips();
    sheet.show(slots, worldName);
    // After the redraw, which drops a focused row or bin. A text field is never focused on its own
    // (`quietTextField`); Enter on Save takes the offered name.
    if (!frame.window.element.contains(document.activeElement)) save.focus();
    if (selectName !== null) sheet.select(slotNamed(selectName)?.id ?? null);
    if (input.value === '') {
      const world = worldName(deps.saveLoad.worldToken);
      // `formatMessage` leaves the unknown `{n}` in place for `autoSaveName` to number.
      const template = world !== null ? formatMessage(copy.autoNameMap, { map: world }) : copy.autoName;
      input.value = autoSaveName(
        template,
        slots.map((slot) => slot.name),
      );
    }
    showHint();
  }

  const saveNow = (): void =>
    run(async (progress) => {
      if (listed === null) return copy.listFailed;
      const name = sanitizedSaveName(input.value);
      if (name === null) return copy.invalidName;
      if (slotNamed(name) !== null) {
        const confirmed = await deps.confirm({
          title: copy.overwrite,
          message: formatMessage(copy.overwriteConfirm, { name }),
          cancel: copy.cancel,
          confirm: copy.overwrite,
          focusConfirm: true,
        });
        if (!confirmed) return copy.notSaved;
      }
      // Exporting and compressing a real map's world blocks the frame, so say so before it starts.
      progress(copy.saving);
      await nextPaint();
      const outcome = await deps.saveLoad.saveGame(slotNamed(name)?.id ?? name);
      if (outcome.kind !== 'saved') return hud.saveFailed;
      input.value = name;
      // The written slot comes up selected, so exporting it is the next click.
      await refresh(name);
      exportButton.focus();
      return formatMessage(copy.savedNamed, { name });
    });
  save.addEventListener('click', saveNow);
  // The selection follows the typed name, so the export button hands out the save that name holds.
  input.addEventListener('input', () => {
    sheet.select(slotNamed(input.value)?.id ?? null);
    showHint();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    // Without this the Enter press goes on to click the overwrite question's focused button.
    event.preventDefault();
    saveNow();
  });

  return {
    el: frame.window.element,
    open(): void {
      run.reset();
      refreshAutosave();
      // The last opening's list may be stale; the overwrite guard waits for this one's.
      listed = null;
      save.disabled = true;
      frame.status(null);
      input.value = '';
      hint.textContent = '';
      exportButton.disabled = true;
      sheet.select(null);
      frame.window.open();
      void refresh();
    },
    close(): void {
      frame.hideTips();
      frame.window.close();
    },
  };
}
