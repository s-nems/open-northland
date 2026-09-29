import { CIVILIZATION_TRIBES, isCivilizationTribe } from '@open-northland/data';
import { formatMessage, messages, tribeName } from '../../../i18n/index.js';
import { selectControl } from './select.js';

/**
 * A seat's civilization picker, shared by the local lobby and a network room. Every civilization is
 * offered; the map's own is labelled recommended, and choosing another shows which one the map was
 * made for.
 */
export function tribePicker(authored: number, change: (tribe: number) => void, className = '') {
  const copy = messages().mainMenu.lobby;
  const choices = CIVILIZATION_TRIBES.map((tribe) => {
    const name = tribeName(tribe);
    return [
      String(tribe),
      tribe === authored ? formatMessage(copy.tribeRecommended, { tribe: name }) : name,
    ] as const;
  });
  const control = selectControl(copy.tribe, choices, (value) => change(Number(value)), className);
  control.root.classList.add('lobby-tribe');
  control.root.title = copy.tribeTitle;
  const note = document.createElement('span');
  note.className = 'lobby-tribe__note';
  note.textContent = formatMessage(copy.tribeMapChoice, { tribe: tribeName(authored) });
  control.root.append(note);
  return {
    root: control.root,
    update(chosen: number, disabled: boolean): void {
      // The world plays the map's own tribe for any other value a relay passes on.
      const tribe = isCivilizationTribe(chosen) ? chosen : authored;
      control.update(String(tribe), disabled);
      const offMap = tribe !== authored;
      control.root.classList.toggle('is-off-map', offMap);
      note.hidden = !offMap;
    },
  };
}
