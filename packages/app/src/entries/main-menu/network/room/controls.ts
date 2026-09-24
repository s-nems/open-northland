import { node } from '../../dom.js';
import { selectControl as lobbySelect } from '../../lobby-controls/select.js';

export function button(text: string, click: () => void): HTMLButtonElement {
  const element = node('button', 'network-room__button', text);
  element.type = 'button';
  element.addEventListener('click', click);
  return element;
}

export function selectControl(
  label: string,
  choices: readonly (readonly [string, string])[],
  change: (value: string) => void,
) {
  return lobbySelect(label, choices, change, 'network-room__field');
}
