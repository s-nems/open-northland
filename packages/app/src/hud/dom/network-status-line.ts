import type { UiCue } from '@open-northland/audio';
import { type Messages, messages } from '../../i18n/index.js';
import type {
  NetClockModel,
  NetNotice,
  NetPanelModel,
  NetPanelSource,
  NetPlayerRow,
} from '../network/model.js';
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
  /** Once a frame; redraws only when what the line says moved or the window opens or closes. */
  refresh(): void;
}

/** What the line says, or null for no line. A notice outranks the slowed line, and a lost link
 *  outranks the world's notice: nothing about the world moves until the link is back. */
function statusLineText(model: NetPanelModel): { readonly text: string; readonly notice: boolean } | null {
  const notice = model.link.notice ?? model.notice?.text ?? null;
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

  // What the text was written from; a model that moved only in the link's figures, the chat or the
  // speed history writes nothing.
  let shownModel: NetPanelModel | null | undefined;
  let shownLinkNotice: string | null = null;
  let shownNotice: NetNotice | null = null;
  let shownGovernor: NetClockModel['governor'] = null;
  let shownSpeed = 0;
  let shownPlayers: readonly NetPlayerRow[] | null = null;
  let shownCopy: Messages | null = null;
  let panelWasOpen = false;
  const moved = (model: NetPanelModel | null, panelOpen: boolean, copy: Messages): boolean => {
    if (shownModel === undefined || panelOpen !== panelWasOpen || copy !== shownCopy) return true;
    if (model === null || shownModel === null) return model !== shownModel;
    return (
      model.link.notice !== shownLinkNotice ||
      model.notice !== shownNotice ||
      model.clock.governor !== shownGovernor ||
      model.clock.runningSpeed !== shownSpeed ||
      model.players !== shownPlayers
    );
  };
  return {
    element: line,
    refresh: () => {
      const model = deps.source.model();
      const panelOpen = deps.panelOpen();
      const copy = messages();
      if (!moved(model, panelOpen, copy)) return;
      shownModel = model;
      panelWasOpen = panelOpen;
      shownCopy = copy;
      if (model !== null) {
        shownLinkNotice = model.link.notice;
        shownNotice = model.notice;
        shownGovernor = model.clock.governor;
        shownSpeed = model.clock.runningSpeed;
        shownPlayers = model.players;
      }
      const said = model === null || panelOpen ? null : statusLineText(model);
      setHidden(line, said === null);
      write(line, said?.text ?? '');
      setClass(line, 'on-net-slowed--notice', said?.notice === true);
    },
  };
}
