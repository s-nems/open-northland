import type { UiCue } from '@open-northland/audio';
import { createNetStatusLine } from '../../hud/dom/network-status-line.js';
import { navBeamRect } from '../../hud/nav-beam.js';
import {
  isHeldStatus,
  type NetClockModel,
  type NetPanelModel,
  type NetPanelSource,
  type NetPlayerRow,
} from '../../hud/network/model.js';
import { speedBarLook } from '../../hud/network/text.js';
import type { ToolPanelController } from '../../hud/tool-panel/index.js';
import { mountChatPanel } from '../net/chat-panel.js';
import { speedControlFor } from '../net/session-clock.js';

export interface NetOverlaysDeps {
  readonly source: NetPanelSource;
  readonly scale: () => number;
  /** The current tool panel controller; a HUD rescale replaces it. */
  readonly controller: () => ToolPanelController;
  readonly cue: (cue: UiCue) => void;
  /** Wall ms, for how long a chat line lingers. */
  readonly now?: () => number;
}

export interface NetOverlays {
  /** Once a frame: the chat's newest lines, the status line, the network window over a hold, and the
   *  speed segments on a new clock. */
  refresh(): void;
  /** True while the relay holds the clock for a member; the world shows the pause wash meanwhile. */
  clockHeld(): boolean;
  dispose(): void;
}

/** True while the relay holds the clock for a member: gone, silent, loading or resyncing. */
const waitsForSomeone = (model: NetPanelModel): boolean =>
  model.players.some((row) => isHeldStatus(row.status));

/** What a relayed game shows beside the network window, all read off the one panel model: the chat
 *  log above the navigation beam, the status line beside the top-right bar, and the speed segments at
 *  the room's running speed. A hold opens the window by itself and its end closes it again, unless the
 *  player took the window over meanwhile. */
export function mountNetOverlays(deps: NetOverlaysDeps): NetOverlays {
  const { source } = deps;
  const chat = mountChatPanel({
    scale: deps.scale,
    beam: () => {
      // The HUD plane is the viewport at 1 / scale design px; the beam stands centred on its foot.
      const scale = deps.scale();
      const beam = navBeamRect({ width: window.innerWidth / scale, height: window.innerHeight / scale }, 1);
      return { x: beam.x * scale, y: beam.y * scale, w: beam.w * scale, h: beam.h * scale };
    },
    onSend: (text) => source.say(text),
    ...(deps.now !== undefined ? { now: deps.now } : {}),
  });
  /** True while the window is open because a hold opened it; any close by the player clears it. */
  let autoOpened = false;
  const statusLine = createNetStatusLine({
    source,
    panelOpen: () => deps.controller().networkOpen(),
    onOpenPanel: () => {
      autoOpened = false;
      deps.controller().openNetwork();
    },
    cue: deps.cue,
  });
  let waiting = false;
  let syncedClock: NetClockModel | null = null;
  let syncedPlayers: readonly NetPlayerRow[] | null = null;
  let syncedController: ToolPanelController | null = null;

  const followHold = (controller: ToolPanelController, model: NetPanelModel): void => {
    if (!controller.networkOpen()) autoOpened = false;
    const nowWaiting = waitsForSomeone(model);
    if (nowWaiting === waiting) return;
    waiting = nowWaiting;
    if (waiting && !controller.networkOpen()) {
      controller.openNetwork();
      autoOpened = true;
    } else if (!waiting && autoOpened) {
      controller.closeNetwork();
      autoOpened = false;
    }
  };

  return {
    refresh: () => {
      const controller = deps.controller();
      const model = source.model();
      if (model !== null) {
        followHold(controller, model);
        // A rescaled HUD's new bar starts plain and bare, so it takes the clock and the line again.
        const rescaled = controller !== syncedController;
        if (rescaled) controller.hangBesideBar(statusLine.element);
        if (rescaled || clockMoved(syncedClock, model.clock)) {
          controller.syncSpeed(speedControlFor(model.clock));
        }
        if (rescaled || model.clock !== syncedClock || model.players !== syncedPlayers) {
          controller.setSpeedLook(speedBarLook(model.clock, model.players));
        }
        syncedClock = model.clock;
        syncedPlayers = model.players;
        syncedController = controller;
      }
      chat.setHidden(controller.networkOpen());
      if (model !== null) chat.refresh(model.chat, model.chatVersion);
      statusLine.refresh();
    },
    clockHeld: () => source.model()?.clock.held === true,
    dispose: () => {
      deps.controller().hangBesideBar(null);
      chat.dispose();
    },
  };
}

/** Whether the bar should take the clock again: a figure it shows changed, or a new clock came with
 *  the same samples (a refused request). A new speed sample alone leaves the bar as the player last
 *  pressed it. */
function clockMoved(shown: NetClockModel | null, next: NetClockModel): boolean {
  if (shown === null) return true;
  if (shown === next) return false;
  return (
    shown.history === next.history ||
    shown.requestedSpeed !== next.requestedSpeed ||
    shown.runningSpeed !== next.runningSpeed ||
    shown.paused !== next.paused
  );
}
