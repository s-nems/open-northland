import { messages } from '../../../i18n/index.js';
import type { EntryRef } from '../../knowledge/model.js';
import { GLYPH } from '../icons.js';
import type { KnowledgeContext } from './context.js';
import { renderEntry } from './entry-view.js';

/** The full entry beside a pinned card: the Encyclopedia's page, unchanged, in a narrower column. */
export interface TreePane {
  readonly element: HTMLElement;
  show(ref: EntryRef): void;
  hide(): void;
}

export function createTreePane(context: KnowledgeContext, onClose: () => void): TreePane {
  const element = document.createElement('aside');
  element.className = 'kn-pane';
  element.hidden = true;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'on-medallion kn-pane__close';
  close.setAttribute('aria-label', messages().knowledge.tree.closePane);
  close.innerHTML = GLYPH.close;
  close.addEventListener('click', onClose);
  const body = document.createElement('div');
  body.className = 'on-parchment kn-page kn-pane__body';
  element.append(close, body);
  return {
    element,
    show: (ref) => {
      context.leavePage();
      body.dataset.keepScroll = `pane-${ref.kind}-${ref.id}`;
      body.replaceChildren(renderEntry(context, ref));
      body.scrollTop = 0;
      element.hidden = false;
    },
    hide: () => {
      context.leavePage();
      element.hidden = true;
      delete body.dataset.keepScroll;
      body.replaceChildren();
    },
  };
}
