import { vi } from 'vitest';

/**
 * Enough of a DOM for HUD components in the node test environment: elements with classes, attributes,
 * inline style, `hidden`, text, a small `innerHTML` parser, tag-and-class selectors, focus and
 * non-bubbling events. Anything it does not model throws or reads as zero, so a test that strays past
 * it fails rather than passing on a blank.
 */

/** The viewport the fake window reports, in client px. */
const VIEWPORT_W = 1280;
const VIEWPORT_H = 720;
const VOID_TAGS = new Set(['input', 'br', 'img', 'hr', 'meta', 'link', 'source']);
const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const TOKEN =
  /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|[^<]+/g;
const ATTRIBUTE = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

const decode = (text: string): string =>
  text.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (whole, name: string) => {
    if (name.startsWith('#x')) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return ENTITIES[name] ?? whole;
  });

export class FakeText {
  parent: FakeElement | null = null;
  constructor(public textContent: string) {}
  remove(): void {
    this.parent?.detach(this);
  }
}

type FakeNode = FakeElement | FakeText;

interface FakeStyle {
  [property: string]: unknown;
  cssText: string;
  setProperty(name: string, value: string): void;
  getPropertyValue(name: string): string;
}

function fakeStyle(): FakeStyle {
  const custom = new Map<string, string>();
  return {
    cssText: '',
    setProperty: (name, value) => custom.set(name, value),
    getPropertyValue: (name) => custom.get(name) ?? '',
  };
}

/** One compound selector: an optional tag and any number of `.class` parts. */
function matches(node: FakeElement, selector: string): boolean {
  const parts = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+)*)$/.exec(selector.trim());
  if (parts === null) throw new Error(`fake dom: unsupported selector ${selector}`);
  const [, tag, classes = ''] = parts;
  if (tag !== undefined && tag.toLowerCase() !== node.tagName.toLowerCase()) return false;
  return classes
    .split('.')
    .filter((name) => name !== '')
    .every((name) => node.classList.contains(name));
}

export class FakeElement extends EventTarget {
  parent: FakeElement | null = null;
  childNodes: FakeNode[] = [];
  hidden = false;
  title = '';
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;
  clientWidth = 0;
  readonly dataset: Record<string, string> = {};
  readonly style = fakeStyle();
  readonly attributes = new Map<string, string>();
  private readonly classes = new Set<string>();
  readonly classList = {
    add: (...names: string[]): void => {
      for (const name of names) this.classes.add(name);
    },
    remove: (...names: string[]): void => {
      for (const name of names) this.classes.delete(name);
    },
    toggle: (name: string, on?: boolean): boolean => {
      const next = on ?? !this.classes.has(name);
      if (next) this.classes.add(name);
      else this.classes.delete(name);
      return next;
    },
    contains: (name: string): boolean => this.classes.has(name),
  };

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {
    super();
  }

  get className(): string {
    return [...this.classes].join(' ');
  }
  set className(value: string) {
    this.classes.clear();
    for (const name of value.split(/\s+/)) if (name !== '') this.classes.add(name);
  }

  get children(): FakeElement[] {
    return this.childNodes.filter((node): node is FakeElement => node instanceof FakeElement);
  }
  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null;
  }
  get lastElementChild(): FakeElement | null {
    return this.children.at(-1) ?? null;
  }
  get childElementCount(): number {
    return this.children.length;
  }

  get textContent(): string {
    return this.childNodes.map((node) => node.textContent).join('');
  }
  set textContent(value: string) {
    this.replaceChildren(...(value === '' ? [] : [value]));
  }

  get innerHTML(): string {
    throw new Error('fake dom: innerHTML is write-only');
  }
  set innerHTML(html: string) {
    this.replaceChildren();
    const open: FakeElement[] = [this];
    for (const token of html.matchAll(TOKEN)) {
      const [text, closing, tag, attributes = '', selfClosing] = token;
      const parent = open.at(-1) ?? this;
      if (text.startsWith('<!--')) continue;
      if (closing !== undefined) {
        const index = open.findLastIndex((node) => node.tagName === closing.toLowerCase());
        if (index > 0) open.length = index;
      } else if (tag !== undefined) {
        const node = this.ownerDocument.createElement(tag);
        for (const [, name = '', double, single, bare] of attributes.matchAll(ATTRIBUTE)) {
          node.setAttribute(name, decode(double ?? single ?? bare ?? ''));
        }
        parent.append(node);
        if (selfClosing === '' && !VOID_TAGS.has(node.tagName)) open.push(node);
      } else {
        parent.append(decode(text));
      }
    }
  }

  append(...nodes: (FakeNode | string)[]): void {
    for (const item of nodes) {
      const node = typeof item === 'string' ? new FakeText(item) : item;
      node.parent?.detach(node);
      node.parent = this;
      this.childNodes.push(node);
    }
  }
  replaceChildren(...nodes: (FakeNode | string)[]): void {
    for (const node of this.childNodes) node.parent = null;
    this.childNodes = [];
    this.append(...nodes);
  }
  detach(node: FakeNode): void {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) this.childNodes.splice(index, 1);
    node.parent = null;
  }
  remove(): void {
    this.parent?.detach(this);
  }

  setAttribute(name: string, value: string): void {
    if (name === 'class') this.className = value;
    else this.attributes.set(name, value);
  }
  getAttribute(name: string): string | null {
    return name === 'class' ? this.className : (this.attributes.get(name) ?? null);
  }
  hasAttribute(name: string): boolean {
    return this.getAttribute(name) !== null;
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.children.flatMap((child) => [
      ...(matches(child, selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  closest(selector: string): FakeElement | null {
    return matches(this, selector) ? this : (this.parent?.closest(selector) ?? null);
  }
  contains(node: FakeNode | null): boolean {
    if (node === null) return false;
    if (node === this) return true;
    return this.childNodes.some((child) => child instanceof FakeElement && child.contains(node));
  }

  focus(): void {
    this.ownerDocument.activeElement = this;
  }
  blur(): void {
    if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
  }
  click(): void {
    this.dispatchEvent(new Event('click'));
  }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
}

export class FakeButton extends FakeElement {
  type = 'submit';
}

export class FakeInput extends FakeElement {
  type = 'text';
  value = '';
}

export class FakeDocument extends EventTarget {
  readonly body: FakeElement;
  readonly documentElement: FakeElement;
  activeElement: FakeElement;
  constructor() {
    super();
    this.documentElement = new FakeElement('html', this);
    this.body = new FakeElement('body', this);
    this.documentElement.append(this.body);
    this.activeElement = this.body;
  }
  createElement(tag: string): FakeElement {
    const name = tag.toLowerCase();
    if (name === 'button') return new FakeButton(name, this);
    if (name === 'input') return new FakeInput(name, this);
    return new FakeElement(name, this);
  }
  createElementNS(_namespace: string, tag: string): FakeElement {
    return new FakeElement(tag, this);
  }
  createTextNode(text: string): FakeText {
    return new FakeText(text);
  }
}

export interface FakeDom {
  readonly document: FakeDocument;
  readonly window: EventTarget;
  /** A fresh element under the body, as the HUD's DOM plane. */
  plane(): FakeElement;
}

/** Stub the DOM globals for one test; `vi.unstubAllGlobals()` in an `afterEach` takes them back. */
export function installFakeDom(): FakeDom {
  const document = new FakeDocument();
  const window = Object.assign(new EventTarget(), { innerWidth: VIEWPORT_W, innerHeight: VIEWPORT_H });
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', window);
  vi.stubGlobal('Element', FakeElement);
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('HTMLButtonElement', FakeButton);
  vi.stubGlobal('HTMLInputElement', FakeInput);
  vi.stubGlobal('HTMLTextAreaElement', class {});
  vi.stubGlobal('HTMLSelectElement', class {});
  vi.stubGlobal('HTMLCanvasElement', class {});
  return {
    document,
    window,
    plane: () => {
      const plane = document.createElement('div');
      document.body.append(plane);
      return plane;
    },
  };
}

/** The DOM type a component takes, for a fake node the test built. */
export const asHtml = (node: FakeElement): HTMLElement => node as unknown as HTMLElement;
