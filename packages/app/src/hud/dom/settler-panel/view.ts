import type { SettlerPanelModel, UnitPanelModel } from '../../details-panel/model/index.js';
import type { ClientRect } from '../portrait-hole.js';
import { createSelectionPanel } from '../selection-panel.js';
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

/** The selected person's panel on the DOM plane. */
export interface SettlerPanel {
  /** Show the model when it is a single settler, else hide. */
  update(model: UnitPanelModel): void;
  hide(): void;
  /** The shown person and the client box the renderer paints its live figure into. */
  portrait(): PortraitSubject | null;
  claims(clientX: number, clientY: number): boolean;
  /** Tab and Shift+Tab: show the next or previous person of the trade; false when there is none. */
  browse(step: 1 | -1): boolean;
  /** The HUD scale changed: the portraits' boxes are measured again. */
  invalidate(): void;
  /** Once a frame, after the paint: the transfer lines fit again after another section or the plane
   *  changed size, and a shown tip follows its control. */
  refresh(): void;
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
  readonly rect: ClientRect;
}

export function createSettlerPanel(deps: SettlerPanelDeps): SettlerPanel {
  const { actions, tradeWindow } = deps;
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

  // A left press anywhere on the panel puts the ring away; the medallion's click then opens it anew.
  frame.element.addEventListener('mousedown', (event) => {
    if (event.button === 0) actions.closeOrders();
  });
  const portrait = createPortraitSection(deps, entity);
  const needs = createNeedsSection(deps, entity);
  const work = createWorkSection(deps, current);
  const production = createProductionSection(deps, current);
  const military = createMilitarySection(deps, entity);
  const trade = createTradeSection(deps, current, () => {
    if (shown === null) return;
    deps.cue('confirm');
    tradeWindow.open(shown);
  });
  tradeWindow.onDismiss(() => trade.focusConfigure());
  const experience = createExperienceSection();
  /**
   * Fit the panel to the plane, measured with every transfer line shown. `full` (a foldable section
   * changed its rows) folds the experience first, the production only if that was not enough, and
   * then keeps the transfer lines that fit: the products and the route are what the player came for.
   * Otherwise only the transfer lines follow the room other sections left.
   */
  const fit = (full: boolean): void => {
    trade.unfit();
    let overflow = frame.overflow();
    if (overflow === 0) return;
    if (full) {
      experience.fold();
      overflow = frame.overflow();
      if (overflow > 0) {
        production.fold();
        overflow = frame.overflow();
      }
    }
    if (overflow > 0) trade.fit(overflow);
  };
  /** Another section or the plane changed size: the transfer lines fit again on the next frame. */
  let refit = false;
  const resizes = new ResizeObserver(() => {
    refit = true;
  });
  /** Paint every section; `fresh` is another person. The foldable sections open in full, and fit
   *  when one of them changed its rows. */
  const sections = (model: SettlerPanelModel, fresh: boolean): void => {
    portrait.update(model);
    needs.update(model);
    work.update(model);
    const reshapedProduction = production.update(model, fresh);
    military.update(model);
    const reshapedTrade = trade.update(model, fresh);
    const reshapedExperience = experience.update(model, fresh);
    if (reshapedProduction || reshapedTrade || reshapedExperience) fit(true);
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
  // The trade section is left out: its own lines are what the fit changes.
  for (const node of [
    frame.body,
    portrait.element,
    needs.element,
    work.element,
    production.element,
    military.element,
    experience.element,
  ]) {
    resizes.observe(node);
  }

  const hide = (): void => {
    if (shown === null) return;
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
    refresh(): void {
      frame.refreshTip();
      if (!refit || shown === null) return;
      refit = false;
      fit(false);
    },
    portrait(): PortraitSubject | null {
      if (shown === null) return null;
      const rect = frame.holeClientRect();
      if (rect === null) return null;
      return {
        entityRef: shown.entityId,
        kind: 'settler',
        ...(shown.inside === null ? {} : { inside: shown.inside }),
        rect,
      };
    },
    claims: (clientX, clientY) => frame.claims(clientX, clientY),
    browse,
    invalidate: () => frame.invalidate(),
    dispose(): void {
      deps.hoverCard.hide();
      deps.tooltip.hide();
      resizes.disconnect();
      frame.dispose();
    },
  };
}
