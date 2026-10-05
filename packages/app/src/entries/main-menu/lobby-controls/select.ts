import { type DropdownChoice, dropdownControl } from '../../../hud/dom/parts/dropdown.js';
import { node } from '../dom.js';

export function selectControl(
  label: string,
  choices: readonly DropdownChoice<string>[],
  change: (value: string) => void,
  className = '',
) {
  const root = node('div', className);
  const dropdown = dropdownControl({
    label,
    className: 'main-menu__dropdown',
    entries: choices,
    active: '',
    onPick: change,
  });
  root.append(node('span', '', label), dropdown.root);
  // The value the menu does not offer, listed after the usual choices while it is the current one.
  let unlisted: string | null = null;
  return {
    root,
    update(value: string, disabled: boolean, label = value): void {
      // Custom protocol values remain readable even when the menu offers only the usual choices.
      const next = choices.some((choice) => choice.id === value) ? null : value;
      if (next !== unlisted) {
        unlisted = next;
        dropdown.setEntries(next === null ? choices : [...choices, { id: next, label }]);
      }
      dropdown.setActive(value);
      dropdown.setDisabled(disabled);
    },
  };
}
