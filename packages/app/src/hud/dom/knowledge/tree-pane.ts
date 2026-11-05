import { messages } from '../../../i18n/index.js';
import type { EntryRef } from '../../knowledge/model.js';
import { GLYPH } from '../icons.js';
import type { KnowledgeContext } from './context.js';
import { renderEntry } from './entry-view.js';

/** The full entry beside a pinned card: the Encyclopedia's page, unchanged, in a narrower column. */
export interface TreePane {
  readonly element: HTMLElement;
  /** The tab at the tree's edge that brings a folded entry back; it shows only while one is folded. */
  readonly opener: HTMLElement;
  show(ref: EntryRef): void;
  hide(): void;
}

/** One per window: a reader who folded the entry away keeps the whole tree on the next pin too. */
const folded = new WeakMap<KnowledgeContext, boolean>();

function medallion(className: string, label: string, glyph: string, press: () => void): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = `on-medallion ${className}`;
  node.setAttribute('aria-label', label);
  node.title = label;
  node.innerHTML = glyph;
  node.addEventListener('click', press);
  return node;
}

export function createTreePane(context: KnowledgeContext, onClose: () => void): TreePane {
  const copy = messages().knowledge.tree;
  const element = document.createElement('aside');
  element.className = 'kn-pane';
  element.hidden = true;
  const opener = document.createElement('button');
  opener.type = 'button';
  opener.className = 'kn-pane__open';
  opener.hidden = true;
  opener.innerHTML = GLYPH.back;
  opener.append(copy.showPane);
  let shown = false;
  const paint = (): void => {
    const isFolded = folded.get(context) === true;
    element.hidden = !shown || isFolded;
    opener.hidden = !shown || !isFolded;
  };
  const fold = (on: boolean): void => {
    folded.set(context, on);
    paint();
  };
  opener.addEventListener('click', () => fold(false));
  const tools = document.createElement('div');
  tools.className = 'kn-pane__tools';
  tools.append(
    medallion('kn-pane__fold', copy.hidePane, GLYPH.next, () => fold(true)),
    medallion('kn-pane__close', copy.closePane, GLYPH.close, onClose),
  );
  const body = document.createElement('div');
  body.className = 'on-parchment kn-page kn-pane__body';
  element.append(tools, body);
  return {
    element,
    opener,
    show: (ref) => {
      context.leavePage();
      body.dataset.keepScroll = `pane-${ref.kind}-${ref.id}`;
      body.replaceChildren(renderEntry(context, ref));
      body.scrollTop = 0;
      shown = true;
      paint();
    },
    hide: () => {
      context.leavePage();
      shown = false;
      paint();
      delete body.dataset.keepScroll;
      body.replaceChildren();
    },
  };
}
