import type { SettlerPanelModel, UnitPanelModel } from '../../details-panel/model/index.js';
import { type ClientRect, createSelectionPanel } from '../selection-panel.js';
import { createTradeWindow } from '../trade-window/window.js';
import type { SettlerPanelDeps } from './actions.js';
import { createExperienceSection } from './experience.js';
import { settlerHead } from './head.js';
import { createMilitarySection } from './military.js';
import { createNeedsSection } from './needs.js';
import { createPeerIndex, NO_PEERS, peerAt, type TradePeers } from './peers.js';
import { createPortraitSection } from './portrait.js';
import { createProductionSection } from './production.js';
import { createTradeSection } from './trade.js';
import { warmModel } from './warm-model.js';
import { createWorkSection } from './work.js';

/** The selected person's panel on the DOM plane (FOUNDATION.md, "Settler panel"). */
export interface SettlerPanel {
  /** Show the model when it is a single settler, else hide. */
  update(model: UnitPanelModel): void;
  hide(): void;
  /** The shown person and the client box the renderer paints its live figure into. */
  portrait(): PortraitSubject | null;
  claims(clientX: number, clientY: number): boolean;
  /** Tab and Shift+Tab: show the next or previous person of the trade; false when there is none. */
  browse(step: 1 | -1): boolean;
  /** The HUD scale changed: the portrait's box is measured again. */
  invalidate(): void;
  /** Step aside (unseen, no pointer, no portrait) while the ring opened from the panel is up. */
  veil(on: boolean): void;
  /** Once a frame: the trade window follows the plane and yields to a beam window. */
  refresh(): void;
  /** Escape: close the trade window; false when it was not open. */
  closeTradeWindow(): boolean;
  tradeWindowOpen(): boolean;
  /** Paint every section once at map start (`SelectionPanel.warm`) with a few of the game's goods on
   *  the icons, so the first selection costs no first-paint work. */
  warm(goodIds: readonly string[]): void;
  dispose(): void;
}

/** The portrait hole's subject and its client box; `inside` names the building the person stepped
 *  into, for the renderer to frame while it draws no figure for them. */
export interface PortraitSubject {
  readonly entityRef: number;
  readonly kind: 'settler';
  readonly inside?: number;
  /** The vehicle the person rides, which the cutout frames while it draws no figure of its own. */
  readonly aboard?: number;
  readonly rect: ClientRect;
}

export function createSettlerPanel(deps: SettlerPanelDeps): SettlerPanel {
  const { actions } = deps;
  let shown: SettlerPanelModel | null = null;
  let peers: TradePeers = NO_PEERS;
  const peerIndex = createPeerIndex(deps.residents, deps.now);
  const entity = (): number => shown?.entityId ?? -1;
  const current = (): SettlerPanelModel | null => shown;

  const browse = (step: 1 | -1): boolean => {
    const next = shown === null ? null : peerAt(peers, step);
    if (next === null) return false;
    actions.show(next);
    return true;
  };
  const ordersKey = (): string => deps.keyLabel('actionRing');
  const frame = createSelectionPanel(
    deps.plane,
    {
      onBrowse: (step) => browse(step),
      onOrders: (press) => actions.openOrders(entity(), press),
      onKickerDoubleClick: () => {
        if (peers.ids.length > 0) actions.selectGroup(peers.ids);
      },
      onRename: (name) => actions.rename(entity(), name),
      onClose: () => actions.clearSelection(),
    },
    deps.tooltip,
  );

  const portrait = createPortraitSection(deps, entity);
  const needs = createNeedsSection(deps, entity);
  const work = createWorkSection(deps, current);
  const production = createProductionSection(deps, current);
  const military = createMilitarySection(deps, entity);
  const tradeWindow = createTradeWindow(deps);
  const trade = createTradeSection(deps, current, () => {
    if (shown === null) return;
    deps.cue('confirm');
    tradeWindow.open(shown);
  });
  tradeWindow.onDismiss(() => trade.focusConfigure());
  const experience = createExperienceSection();
  /** Paint every section; `fresh` is another person. The foldable sections open in full; when the
   *  whole panel would then run past the plane (read once per change of their rows) the experience
   *  folds first, the production only if that was not enough, and the trade last: the products and
   *  the route are what the player came for. */
  const sections = (model: SettlerPanelModel, fresh: boolean): void => {
    portrait.update(model);
    needs.update(model);
    work.update(model);
    const reshapedProduction = production.update(model, fresh);
    military.update(model);
    const reshapedTrade = trade.update(model, fresh);
    const reshapedExperience = experience.update(model, fresh);
    if ((reshapedProduction || reshapedTrade || reshapedExperience) && frame.overflows()) {
      experience.fold();
      if (frame.overflows()) production.fold();
      if (frame.overflows()) trade.fold();
    }
  };
  frame.body.append(
    portrait.element,
    needs.element,
    work.element,
    production.element,
    military.element,
    trade.element,
    experience.element,
  );
  frame.setHole(portrait.frame);

  const hide = (): void => {
    shown = null;
    tradeWindow.close();
    peers = NO_PEERS;
    deps.hoverCard.hide();
    deps.tooltip.hide();
    frame.hide();
  };

  return {
    update(model): void {
      if (model.kind !== 'settler') {
        hide();
        return;
      }
      // Another person: the fold opens and the trade's people are read again.
      const fresh = shown?.entityId !== model.entityId;
      shown = model;
      peers = model.foreign ? NO_PEERS : peerIndex.peersOf(model.entityId, model.jobType, fresh);
      frame.updateHead(settlerHead(model, peers, ordersKey()));
      // Shown before the sections: the fold's overflow read needs the frame laid out.
      frame.show();
      sections(model, fresh);
      tradeWindow.update(model);
    },
    hide,
    warm(goodIds): void {
      const model = warmModel(goodIds);
      frame.updateHead(settlerHead(model, NO_PEERS, ordersKey()));
      sections(model, true);
      frame.warm();
      tradeWindow.warm(model);
    },
    refresh: () => tradeWindow.refresh(),
    closeTradeWindow(): boolean {
      if (!tradeWindow.isOpen()) return false;
      tradeWindow.dismiss();
      return true;
    },
    tradeWindowOpen: () => tradeWindow.isOpen(),
    portrait(): PortraitSubject | null {
      if (shown === null) return null;
      const rect = frame.holeClientRect();
      if (rect === null) return null;
      return {
        entityRef: shown.entityId,
        kind: 'settler',
        ...(shown.inside === null ? {} : { inside: shown.inside }),
        ...(shown.aboard === null ? {} : { aboard: shown.aboard }),
        rect,
      };
    },
    claims: (clientX, clientY) => frame.claims(clientX, clientY) || tradeWindow.claims(clientX, clientY),
    browse,
    invalidate: () => frame.invalidate(),
    veil(on): void {
      frame.veil(on);
      tradeWindow.veil(on);
    },
    dispose(): void {
      deps.hoverCard.hide();
      deps.tooltip.hide();
      tradeWindow.dispose();
      frame.dispose();
    },
  };
}
