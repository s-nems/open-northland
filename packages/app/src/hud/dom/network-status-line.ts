import type { UiCue } from '@open-northland/audio';
import { messages } from '../../i18n/index.js';
import type { NetPanelModel, NetPanelSource } from '../network/model.js';
import { slowedText } from '../network/text.js';
import { button, setClass, setHidden, setTip, write } from './parts/dom.js';

export interface NetStatusLineDeps {
  readonly source: NetPanelSource;
  /** True while the network window is open: it says everything the line does. */
  readonly panelOpen: () => boolean;
  readonly onOpenPanel: () => void;
  readonly cue: (cue: UiCue) => void;
}

/** The one line a relayed game shows outside the network window: a notice about this client's link or
 *  world, else who the room is slowed for. A click opens the window. */
export interface NetStatusLine {
  readonly element: HTMLButtonElement;
  /** Once a frame; redraws only on a new model or when the window opens or closes. */
  refresh(): void;
}

/** What the line says, or null for no line. A notice outranks the slowed line, and a lost link
 *  outranks the world's notice: nothing about the world moves until the link is back. */
export function statusLineText(
  model: NetPanelModel,
): { readonly text: string; readonly notice: boolean } | null {
  const notice = model.link.notice ?? model.notice;
  if (notice !== null) return { text: notice, notice: true };
  const slowed = slowedText(model.clock, model.players);
  return slowed === null ? null : { text: slowed, notice: false };
}

export function createNetStatusLine(deps: NetStatusLineDeps): NetStatusLine {
  const line = button('on-net-slowed');
  line.hidden = true;
  setTip(line, messages().hud.network.open);
  line.addEventListener('click', () => {
    deps.cue('confirm');
    deps.onOpenPanel();
  });

  let shown: NetPanelModel | null = null;
  let panelWasOpen = false;
  return {
    element: line,
    refresh: () => {
      const model = deps.source.model();
      const panelOpen = deps.panelOpen();
      if (model === shown && panelOpen === panelWasOpen) return;
      shown = model;
      panelWasOpen = panelOpen;
      const said = model === null || panelOpen ? null : statusLineText(model);
      setHidden(line, said === null);
      write(line, said?.text ?? '');
      setClass(line, 'on-net-slowed--notice', said?.notice === true);
    },
  };
}
