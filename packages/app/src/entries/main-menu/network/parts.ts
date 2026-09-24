import { node } from '../dom.js';

export function button(text: string, action: () => void): HTMLButtonElement {
  const result = node('button', 'main-menu__ghost', text);
  result.type = 'button';
  result.addEventListener('click', action);
  return result;
}

export function field(text: string, input: HTMLElement): HTMLLabelElement {
  const label = node('label', 'network-menu__field');
  label.append(node('span', '', text), input);
  return label;
}
