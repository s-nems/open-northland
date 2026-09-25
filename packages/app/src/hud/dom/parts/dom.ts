/**
 * The patch-not-rebuild helpers the DOM HUD writes through: a tick rewrites mostly the same words, and
 * an unchanged write would still dirty the layout the next read forces.
 */

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  html = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.innerHTML = html;
  return node;
}

export function button(className: string, html = ''): HTMLButtonElement {
  const node = element('button', className, html);
  node.type = 'button';
  return node;
}

export function write(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function setAttribute(node: Element, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

export function removeAttribute(node: Element, name: string): void {
  if (node.hasAttribute(name)) node.removeAttribute(name);
}

export function setHidden(node: HTMLElement, hidden: boolean): void {
  if (node.hidden !== hidden) node.hidden = hidden;
}

export function setClass(node: Element, name: string, on: boolean): void {
  if (node.classList.contains(name) !== on) node.classList.toggle(name, on);
}

export function setTitle(node: HTMLElement, text: string): void {
  if (node.title !== text) node.title = text;
}

/** A control the player may see but not press: faded, still focusable, its reason in the tooltip. */
export function setDisabled(node: HTMLElement, disabled: boolean): void {
  if (disabled) setAttribute(node, 'aria-disabled', 'true');
  else removeAttribute(node, 'aria-disabled');
}

export function isDisabled(node: Element): boolean {
  return node.getAttribute('aria-disabled') === 'true';
}

export function setValue(control: HTMLSelectElement | HTMLInputElement, value: string): void {
  if (control.value !== value) control.value = value;
}
