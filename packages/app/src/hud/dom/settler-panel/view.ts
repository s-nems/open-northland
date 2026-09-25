import type { SettlerPanelModel, UnitPanelModel } from '../../details-panel/model/index.js';
import { type ClientRect, createSelectionPanel } from '../selection-panel.js';
import type { SettlerPanelDeps } from './actions.js';
import { createExperienceSection } from './experience.js';
import { settlerHead } from './head.js';
import { createMilitarySection } from './military.js';
import { createNeedsSection } from './needs.js';
import { createPeerIndex, NO_PEERS, peerAt, type TradePeers } from './peers.js';
import { createPortraitSection } from './portrait.js';
import { createProductionSection } from './production.js';
import { createTradeSection } from './trade.js';
import { createWorkSection } from './work.js';

/** The selected person's panel on the DOM plane (FOUNDATION.md, "Settler panel"). */
export interface SettlerPanel {
  /** Show the model when it is a single settler, else hide; `structural` when the selection changed. */
  update(model: UnitPanelModel, structural: boolean): void;
  hide(): void;
  /** The shown settler and the client box the renderer paints its live figure into. */
  portrait(): { readonly entityRef: number; readonly rect: ClientRect } | null;
  claims(clientX: number, clientY: number): boolean;
  /** Tab and Shift+Tab: show the next or previous person of the trade; false when there is none. */
  browse(step: 1 | -1): boolean;
  /** The HUD scale changed: the portrait's box is measured again. */
  invalidate(): void;
  dispose(): void;
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
    actions.showPeer(next);
    return true;
  };
  const frame = createSelectionPanel(deps.plane, {
    onBrowse: (step) => browse(step),
    onKickerDoubleClick: () => {
      if (peers.ids.length > 0) actions.selectGroup(peers.ids);
    },
    onRename: (name) => actions.rename(entity(), name),
    onOrders: () => actions.openOrders(entity()),
    onClose: () => actions.clearSelection(),
  });

  const portrait = createPortraitSection(deps, entity);
  const needs = createNeedsSection(deps, entity);
  const work = createWorkSection(deps, current);
  const production = createProductionSection(deps, current);
  const military = createMilitarySection(deps, entity);
  const trade = createTradeSection(deps, current);
  const experience = createExperienceSection();
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
    peers = NO_PEERS;
    deps.hoverCard.hide();
    frame.hide();
  };

  return {
    update(model, structural): void {
      if (model.kind !== 'settler') {
        hide();
        return;
      }
      const fresh = structural || shown?.entityId !== model.entityId;
      shown = model;
      peers = model.foreign ? NO_PEERS : peerIndex.peersOf(model.entityId, model.jobType, fresh);
      frame.updateHead(settlerHead(model, peers, deps.keyLabel('actionRing')));
      portrait.update(model);
      needs.update(model);
      work.update(model);
      production.update(model);
      military.update(model);
      trade.update(model);
      experience.update(model, fresh);
      frame.show();
    },
    hide,
    portrait(): { readonly entityRef: number; readonly rect: ClientRect } | null {
      if (shown === null) return null;
      const rect = frame.holeClientRect();
      return rect === null ? null : { entityRef: shown.entityId, rect };
    },
    claims: (clientX, clientY) => frame.claims(clientX, clientY),
    browse,
    invalidate: () => frame.invalidate(),
    dispose(): void {
      deps.hoverCard.hide();
      frame.dispose();
    },
  };
}
