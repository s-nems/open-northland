import type { TraderSubject, UnitPanelModel, VehiclePanelModel } from '../../details-panel/model/index.js';
import { type FigureSlot, NO_FIGURE_SLOTS } from '../../figures/live-figures.js';
import { FigureWellSlots, markDrawnWells } from '../parts/figure-well.js';
import type { ClientRect } from '../portrait-hole.js';
import { createSelectionPanel } from '../selection-panel.js';
import { NO_PEERS, PEERS_REFRESH_MS, peerAt, type TradePeers } from '../settler-panel/peers.js';
import { createTradeSection } from '../settler-panel/trade.js';
import type { VehiclePanelDeps } from './actions.js';
import { createCrewSection } from './crew.js';
import { vehicleHead } from './head.js';
import { createHoldSection } from './hold.js';
import { createMilitarySection } from './military.js';
import { createPortraitSection } from './portrait.js';
import { warmVehicleModel } from './warm-model.js';

/** The selected vehicle's panel on the DOM plane (FOUNDATION.md, "Vehicle panel"). */
export interface VehiclePanel {
  /** Show the model when it is a single vehicle, else hide. */
  update(model: UnitPanelModel): void;
  hide(): void;
  /** The shown vehicle and the client box the renderer paints it into. */
  portrait(): VehiclePortraitSubject | null;
  claims(clientX: number, clientY: number): boolean;
  /** Tab and Shift+Tab: show the seat's next or previous vehicle of the class; false when there is none. */
  browse(step: 1 | -1): boolean;
  /** Escape: close the add-a-good picker; false when it was not open. */
  closePicker(): boolean;
  /** The HUD scale changed: the portrait's box is measured again. */
  invalidate(): void;
  /** Once a frame, after the paint: the armed order lights, the transfer lines fit again after the plane
   *  changed size, and a shown tip follows its control. */
  refresh(): void;
  /** The crew wells' figures, which the owner paints live every frame; none while hidden. */
  figureSlots(): readonly FigureSlot[];
  /** After the paint: a well whose figure was drawn hides its stand-in glyph. */
  markDrawn(drawn: ReadonlySet<number>): void;
  /** Paint every section once at map start, so the first selection costs no first-paint work. */
  warm(goodIds: readonly string[]): void;
  dispose(): void;
}

/** The portrait hole's subject: the vehicle, framed on the ship that carries it while it rides one. */
export interface VehiclePortraitSubject {
  readonly entityRef: number;
  readonly kind: 'vehicle';
  readonly aboard?: number;
  readonly rect: ClientRect;
}

/** A vehicle no trader rides: its Handel section hides. */
const NO_TRADER: TraderSubject = { entityId: -1, name: '', trade: null };

export function createVehiclePanel(deps: VehiclePanelDeps): VehiclePanel {
  const { actions, tradeWindow } = deps;
  let shown: VehiclePanelModel | null = null;
  let peers: TradePeers = NO_PEERS;
  let peersAt = Number.NEGATIVE_INFINITY;
  const current = (): VehiclePanelModel | null => shown;
  const trader = (): TraderSubject | null => shown?.trade ?? null;

  const browse = (step: 1 | -1): boolean => {
    const next = shown === null ? null : peerAt(peers, step);
    if (next === null) return false;
    actions.show(next);
    return true;
  };
  const frame = createSelectionPanel(
    deps.plane,
    {
      onBrowse: (step) => browse(step),
      onOrders: () => {},
      onKickerDoubleClick: () => {
        if (peers.ids.length > 0) actions.selectGroup(peers.ids);
      },
      onRename: () => {},
      onClose: () => actions.clearSelection(),
    },
    deps.tooltip,
  );

  const portrait = createPortraitSection(deps, current);
  const military = createMilitarySection(deps, current);
  const crew = createCrewSection(deps, current);
  const figureSlots = new FigureWellSlots();
  const trade = createTradeSection(deps, trader, () => {
    const subject = trader();
    if (subject === null) return;
    deps.cue('confirm');
    tradeWindow.open(subject);
  });
  tradeWindow.onDismiss(() => trade.focusConfigure());
  const hold = createHoldSection(deps, current);
  frame.body.append(portrait.element, military.element, crew.element, trade.element, hold.element);
  frame.setHole(portrait.frame);

  /** Fit the panel to the plane: only the transfer lines give way, the rest is the vehicle itself. */
  const fit = (): void => {
    trade.unfit();
    const overflow = frame.overflow();
    if (overflow > 0) trade.fit(overflow);
  };
  let refit = false;
  const resizes = new ResizeObserver(() => {
    refit = true;
  });
  for (const node of [frame.body, portrait.element, military.element, crew.element, hold.element]) {
    resizes.observe(node);
  }

  const readPeers = (model: VehiclePanelModel, fresh: boolean): TradePeers => {
    if (model.foreign) return NO_PEERS;
    const at = deps.now();
    if (fresh || at - peersAt >= PEERS_REFRESH_MS) {
      peersAt = at;
      const ids = deps.vehiclePeers(model.entityId);
      peers = { ids, index: ids.indexOf(model.entityId) };
    }
    return peers;
  };
  const sections = (model: VehiclePanelModel, fresh: boolean): void => {
    portrait.update(model);
    military.update(model);
    crew.update(model);
    const reshaped = trade.update(model.trade ?? NO_TRADER, fresh);
    hold.update(model);
    if (reshaped) fit();
  };

  const hide = (): void => {
    if (shown === null) return;
    shown = null;
    peers = NO_PEERS;
    hold.closePicker();
    tradeWindow.close();
    deps.hoverCard.hide();
    deps.tooltip.hide();
    frame.hide();
  };

  return {
    update(model): void {
      if (model.kind !== 'vehicle') {
        hide();
        return;
      }
      const fresh = shown?.entityId !== model.entityId;
      shown = model;
      peers = readPeers(model, fresh);
      frame.updateHead(vehicleHead(model, peers));
      frame.show();
      sections(model, fresh);
      if (model.trade !== null) tradeWindow.update(model.trade);
      else if (tradeWindow.isOpen()) tradeWindow.close();
    },
    hide,
    warm(goodIds): void {
      const model = warmVehicleModel(goodIds);
      frame.updateHead(vehicleHead(model, NO_PEERS));
      sections(model, true);
      frame.warm();
    },
    refresh(): void {
      const armed = shown === null ? null : deps.armedPick(shown.entityId);
      portrait.refresh(armed);
      crew.refresh(armed);
      frame.refreshTip();
      if (!refit || shown === null) return;
      refit = false;
      fit();
    },
    closePicker: () => shown !== null && hold.closePicker(),
    figureSlots: () => (shown === null ? NO_FIGURE_SLOTS : figureSlots.of(crew.wells())),
    markDrawn: (drawn) => markDrawnWells(crew.wells(), drawn),
    portrait(): VehiclePortraitSubject | null {
      if (shown === null) return null;
      const rect = frame.holeClientRect();
      if (rect === null) return null;
      const carrier = shown.status.carrier;
      return {
        entityRef: shown.entityId,
        kind: 'vehicle',
        ...(carrier === null ? {} : { aboard: carrier.id }),
        rect,
      };
    },
    claims: (clientX, clientY) => frame.claims(clientX, clientY),
    browse,
    invalidate: () => frame.invalidate(),
    dispose(): void {
      resizes.disconnect();
      frame.dispose();
    },
  };
}
