import type { UiCue } from '@open-northland/audio';
import { createNetBanners } from '../../hud/dom/network-banners.js';
import type { NetClockModel, NetPanelSource } from '../../hud/network/model.js';
import { governedBarTitle } from '../../hud/network/text.js';
import type { ToolPanelController } from '../../hud/tool-panel/index.js';
import { mountChatPanel } from '../net/chat-panel.js';
import { speedControlFor } from '../net/session-clock.js';

export interface NetOverlaysDeps {
  readonly source: NetPanelSource;
  /** The HUD's DOM plane, which the banners mount on. */
  readonly plane: HTMLElement;
  readonly scale: () => number;
  /** The chat log's left edge in client px, clear of the minimap. */
  readonly leftPx: () => number;
  /** The current tool panel controller; a HUD rescale replaces it. */
  readonly controller: () => ToolPanelController;
  readonly cue: (cue: UiCue) => void;
}

export interface NetOverlays {
  /** Once a frame: the chat's newest lines, the banners, and the speed segments on a new clock. */
  refresh(): void;
  dispose(): void;
}

/** What a relayed game shows beside the network window, all read off the one panel model: the chat
 *  log, the held banner, the slowed line, and the speed segments at the room's running speed. */
export function mountNetOverlays(deps: NetOverlaysDeps): NetOverlays {
  const { source } = deps;
  const chat = mountChatPanel({ leftPx: deps.leftPx, onSend: (text) => source.say(text) });
  const banners = createNetBanners({
    plane: deps.plane,
    source,
    scale: deps.scale,
    chatAnchor: () => chat.anchor(),
    onOpenPanel: () => deps.controller().openNetwork(),
    panelOpen: () => deps.controller().networkOpen(),
    cue: deps.cue,
  });
  let syncedClock: NetClockModel | null = null;
  let syncedController: ToolPanelController | null = null;
  return {
    refresh: () => {
      chat.updateLayout();
      chat.setHidden(deps.controller().networkOpen());
      const model = source.model();
      if (model !== null) {
        chat.show(model.chat, model.chatVersion);
        // A rescaled HUD's new bar starts plain, so it takes the clock again.
        const controller = deps.controller();
        if (model.clock !== syncedClock || controller !== syncedController) {
          syncedClock = model.clock;
          syncedController = controller;
          controller.syncSpeed(speedControlFor(model.clock), governedBarTitle(model.clock));
        }
      }
      banners.refresh();
    },
    dispose: () => {
      banners.dispose();
      chat.dispose();
    },
  };
}
