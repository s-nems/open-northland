/**
 * The patch-not-rebuild helpers the DOM HUD writes through: a tick rewrites mostly the same words, and
 * an unchanged write would still dirty the layout the next read forces.
 */

/** Text set into markup a template builds, such as a map's page or a label. */
export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

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

/** Each writer below returns whether it changed the node. */
export function write(node: Element, text: string): boolean {
  if (node.textContent === text) return false;
  node.textContent = text;
  return true;
}

export function setAttribute(node: Element, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

export function removeAttribute(node: Element, name: string): void {
  if (node.hasAttribute(name)) node.removeAttribute(name);
}

export function setHidden(node: HTMLElement, hidden: boolean): boolean {
  if (node.hidden === hidden) return false;
  node.hidden = hidden;
  return true;
}

export function setClass(node: Element, name: string, on: boolean): boolean {
  if (node.classList.contains(name) === on) return false;
  node.classList.toggle(name, on);
  return true;
}

/** A CSS custom property on the node's inline style, such as a meter's `--value`. */
export function setStyleVar(node: HTMLElement, name: `--${string}`, value: string): void {
  if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
}

export function setTitle(node: HTMLElement, text: string): void {
  if (node.title !== text) node.title = text;
}

/** The attribute a tip layer (`tip-layer.ts`) reads the hovered control's tooltip from. */
export const TIP_ATTRIBUTE = 'data-tip';

/** Where assistive tech reads a tip: a disabled control's reason lives only there and in the chip. */
const DESCRIPTION_ATTRIBUTE = 'aria-description';

/** The control's tooltip for the tip layer of the surface it sits on; empty removes it. */
export function setTip(node: HTMLElement, text: string): void {
  if (text === '') {
    removeAttribute(node, TIP_ATTRIBUTE);
    removeAttribute(node, DESCRIPTION_ATTRIBUTE);
    return;
  }
  setAttribute(node, TIP_ATTRIBUTE, text);
  // A tip that is the control's name already would be read twice as its description.
  if (node.getAttribute('aria-label') === text) removeAttribute(node, DESCRIPTION_ATTRIBUTE);
  else setAttribute(node, DESCRIPTION_ATTRIBUTE, text);
}

/** A control the player may see but not press: faded, still focusable, its reason in the tooltip. */
export function setDisabled(node: HTMLElement, disabled: boolean): void {
  if (disabled) setAttribute(node, 'aria-disabled', 'true');
  else removeAttribute(node, 'aria-disabled');
}

/**
 * A control's press, with the keys held. On macOS the browser turns Ctrl + left click into a context
 * menu press and fires no `click`, so that press is taken as the Ctrl click it was; a plain right click
 * is not a press.
 */
export function onPress(node: HTMLElement, handler: (event: MouseEvent) => void): void {
  node.addEventListener('click', handler);
  node.addEventListener('contextmenu', (event) => {
    if (event.ctrlKey) handler(event);
  });
}

export function isDisabled(node: Element): boolean {
  return node.getAttribute('aria-disabled') === 'true';
}

export function setValue(control: HTMLInputElement, value: string): void {
  if (control.value !== value) control.value = value;
}
