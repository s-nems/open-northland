export function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function button(text: string, action: () => void, primary = false): HTMLButtonElement {
  const result = node('button', primary ? 'main-menu__primary' : 'main-menu__ghost', text);
  result.type = 'button';
  result.addEventListener('click', action);
  return result;
}

export function field(text: string, input: HTMLElement): HTMLLabelElement {
  const label = node('label', 'network-menu__field');
  label.append(node('span', '', text), input);
  return label;
}
