import type { UiCue } from '@open-northland/audio';
import { messages } from '../../i18n/index.js';
import type { NetPanelModel, NetPanelSource } from '../network/model.js';
import { heldLines, slowedText } from '../network/text.js';
import { button, element, setHidden, setStyleVar, write } from './parts/dom.js';

/** Design px between the chat log's top edge and the slowed line. */
const SLOWED_GAP = 6;

export interface NetBannersDeps {
  readonly plane: HTMLElement;
  readonly source: NetPanelSource;
  /** The HUD's scale: client px per design px. */
  readonly scale: () => number;
  /** The chat log's left and top edge in client px, which the slowed line sits just above. */
  readonly chatAnchor: () => { readonly left: number; readonly top: number };
  readonly onOpenPanel: () => void;
  /** True while the network window is open: it says everything the banners do. */
  readonly panelOpen: () => boolean;
  readonly cue: (cue: UiCue) => void;
}

/** The two notes a relayed game shows outside the network window: the banner over a held game, and
 *  the line above the chat while the room is slowed for someone. Both open the window. */
export interface NetBanners {
  /** Once a frame: redraw on a new model and keep the slowed line over the chat. */
  refresh(): void;
  dispose(): void;
}

export function createNetBanners(deps: NetBannersDeps): NetBanners {
  const copy = messages().hud.network;
  const held = element('section', 'on-panel on-net-held');
  held.setAttribute('role', 'status');
  held.hidden = true;
  const title = element('h2', 'on-net-held__title');
  title.textContent = copy.heldTitle;
  const notice = element('p', 'on-net-held__notice');
  const lines = element('ul', 'on-net-held__lines');
  const open = button('on-button on-button--rounded on-net-held__open');
  open.textContent = copy.open;
  held.append(title, notice, lines, open);

  const slowed = button('on-net-slowed');
  slowed.hidden = true;

  for (const control of [open, slowed]) {
    control.addEventListener('click', () => {
      deps.cue('confirm');
      deps.onOpenPanel();
    });
  }
  deps.plane.append(held, slowed);

  const showHeld = (model: NetPanelModel): void => {
    const rows = model.clock.held ? heldLines(model.players) : [];
    setHidden(held, rows.length === 0 && model.notice === null);
    setHidden(title, rows.length === 0);
    write(notice, model.notice ?? '');
    setHidden(notice, model.notice === null);
    const key = rows.join('\n');
    if (lines.dataset.shown !== key) {
      lines.dataset.shown = key;
      lines.replaceChildren(
        ...rows.map((text) => {
          const item = element('li', '');
          item.textContent = text;
          return item;
        }),
      );
    }
  };

  const showSlowed = (model: NetPanelModel): void => {
    const text = slowedText(model.clock, model.players);
    setHidden(slowed, text === null);
    write(slowed, text ?? '');
  };

  /** The chat grows upward from the bottom edge, so the line follows its top as lines arrive. */
  const placeSlowed = (): void => {
    if (slowed.hidden) return;
    const scale = deps.scale();
    const anchor = deps.chatAnchor();
    setStyleVar(slowed, '--left', `${anchor.left / scale}px`);
    setStyleVar(slowed, '--bottom', `${deps.plane.clientHeight - anchor.top / scale + SLOWED_GAP}px`);
  };

  let shown: NetPanelModel | null = null;
  let panelWasOpen = false;
  return {
    refresh: () => {
      const model = deps.source.model();
      const panelOpen = deps.panelOpen();
      if (model !== shown || panelOpen !== panelWasOpen) {
        shown = model;
        panelWasOpen = panelOpen;
        if (model === null || panelOpen) {
          setHidden(held, true);
          setHidden(slowed, true);
        } else {
          showHeld(model);
          showSlowed(model);
        }
      }
      placeSlowed();
    },
    dispose: () => {
      held.remove();
      slowed.remove();
    },
  };
}
