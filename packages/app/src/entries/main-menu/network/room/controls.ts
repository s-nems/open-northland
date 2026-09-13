import { selectControl as lobbySelect } from '../../lobby-controls/select.js';

export function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = '',
  className = '',
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
}

export function button(text: string, click: () => void): HTMLButtonElement {
  const element = node('button', text, 'network-room__button');
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
