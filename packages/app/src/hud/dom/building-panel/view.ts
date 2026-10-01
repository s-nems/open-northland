import type { BuildingPanelModel, UnitPanelModel } from '../../details-panel/model/index.js';
import { type FigureSlot, NO_FIGURE_SLOTS } from '../../figures/live-figures.js';
import { type FigureWell, FigureWellSlots, markDrawnWells } from '../parts/figure-well.js';
import type { ClientRect } from '../portrait-hole.js';
import { createSelectionPanel } from '../selection-panel.js';
import { NO_PEERS, peerAt, type TradePeers } from '../settler-panel/peers.js';
import type { BuildingPanelDeps } from './actions.js';
import { createConstructionSection } from './construction.js';
import { buildingHead } from './head.js';
import { createHomeSection } from './home.js';
import { createOffersSection } from './offers.js';
import { createPortraitSection } from './portrait.js';
import { createProductionSection } from './production.js';
import { createStaffSection } from './staff.js';
import { createStockSection } from './stock.js';
import { warmBuildingModel } from './warm-model.js';

/** The selected building's panel on the DOM plane (FOUNDATION.md, "Building panel"). */
export interface BuildingPanel {
  /** Show the model when it is a single building, else hide. */
  update(model: UnitPanelModel): void;
  hide(): void;
  /** The shown building and the client box the renderer paints it into. */
  portrait(): BuildingPortraitSubject | null;
  claims(clientX: number, clientY: number): boolean;
  /** Tab and Shift+Tab: show the owner's next or previous building of the type; false when there is none. */
  browse(step: 1 | -1): boolean;
  /** The upgrade key: press the shown building's Rozbuduj tile; false when none is shown or it refuses. */
  upgrade(): boolean;
  /** The HUD scale changed: the portrait's box is measured again. */
  invalidate(): void;
  /** Once a frame, after the paint: the stock list fits again after the plane changed size, and a shown
   *  tip follows its control. */
  refresh(): void;
  /** The person wells' figures, which the owner paints live every frame; none while hidden. */
  figureSlots(): readonly FigureSlot[];
  /** After the paint: a well whose figure was drawn hides its stand-in glyph. */
  markDrawn(drawn: ReadonlySet<number>): void;
  /** Paint every section once at map start, so the first selection costs no first-paint work. */
  warm(goodIds: readonly string[]): void;
  dispose(): void;
}

export interface BuildingPortraitSubject {
  readonly entityRef: number;
  readonly kind: 'building';
  readonly rect: ClientRect;
}

export function createBuildingPanel(deps: BuildingPanelDeps): BuildingPanel {
  const { actions } = deps;
  let shown: BuildingPanelModel | null = null;
  let peers: TradePeers = NO_PEERS;
  const current = (): BuildingPanelModel | null => shown;

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
      onKickerDoubleClick: () => {},
      onRename: () => {},
      onClose: () => actions.clearSelection(),
    },
    deps.tooltip,
  );

  const portrait = createPortraitSection(deps, current);
  const construction = createConstructionSection(deps);
  const crew = createStaffSection(deps, (model) => model.crew);
  const staff = createStaffSection(deps, (model) => model.staff);
  const production = createProductionSection(deps);
  const stock = createStockSection(deps);
  const home = createHomeSection(deps);
  const offers = createOffersSection(deps);
  frame.body.append(
    portrait.element,
    construction.element,
    crew.element,
    staff.element,
    production.element,
    home.element,
    offers.element,
    stock.element,
  );
  frame.setHole(portrait.frame);

  /** Fit the panel to the plane: only the stock list gives way, the rest is the house itself. */
  const fit = (): void => {
    stock.unfit();
    const overflow = frame.overflow();
    if (overflow > 0) stock.fit(overflow);
  };
  let refit = true;
  const resizes = new ResizeObserver(() => {
    refit = true;
  });
  // The stock list is left out: its own height is what the fit changes. A section above it can grow
  // while the body stands at its cap, which the body's own box would not report.
  for (const node of [
    frame.body,
    portrait.element,
    construction.element,
    crew.element,
    staff.element,
    production.element,
    home.element,
    offers.element,
  ]) {
    resizes.observe(node);
  }

  const sections = (model: BuildingPanelModel, fresh: boolean): void => {
    portrait.update(model);
    construction.update(model);
    crew.update(model);
    staff.update(model);
    production.update(model);
    home.update(model);
    offers.update(model);
    stock.update(model, fresh);
  };

  /** Both sections' wells as one list, rebuilt only when either section rebuilt its wells. */
  let wellsMemo: {
    crew: readonly FigureWell[];
    staff: readonly FigureWell[];
    all: readonly FigureWell[];
  } = { crew: [], staff: [], all: [] };
  const figureWells = (): readonly FigureWell[] => {
    const crewWells = crew.wells();
    const staffWells = staff.wells();
    if (wellsMemo.crew !== crewWells || wellsMemo.staff !== staffWells) {
      wellsMemo = { crew: crewWells, staff: staffWells, all: [...crewWells, ...staffWells] };
    }
    return wellsMemo.all;
  };
  const figureSlots = new FigureWellSlots();

  const hide = (): void => {
    if (shown === null) return;
    shown = null;
    peers = NO_PEERS;
    deps.tooltip.hide();
    frame.hide();
  };

  return {
    update(model): void {
      if (model.kind !== 'building') {
        hide();
        return;
      }
      const fresh = shown?.entityId !== model.entityId;
      shown = model;
      const ids = model.foreign ? [] : deps.buildingPeers(model.entityId);
      peers = { ids, index: ids.indexOf(model.entityId) };
      frame.updateHead(buildingHead(model, peers));
      frame.show();
      sections(model, fresh);
      if (fresh) refit = true;
    },
    hide,
    warm(goodIds): void {
      const model = warmBuildingModel(goodIds);
      frame.updateHead(buildingHead(model, NO_PEERS));
      sections(model, true);
      frame.warm();
    },
    refresh(): void {
      frame.refreshTip();
      if (!refit || shown === null) return;
      refit = false;
      fit();
    },
    figureSlots: () => (shown === null ? NO_FIGURE_SLOTS : figureSlots.of(figureWells())),
    markDrawn: (drawn) => markDrawnWells(figureWells(), drawn),
    portrait(): BuildingPortraitSubject | null {
      if (shown === null) return null;
      const rect = frame.holeClientRect();
      return rect === null ? null : { entityRef: shown.entityId, kind: 'building', rect };
    },
    claims: (clientX, clientY) => frame.claims(clientX, clientY),
    browse,
    upgrade: () => portrait.press('upgrade'),
    invalidate: () => frame.invalidate(),
    dispose(): void {
      resizes.disconnect();
      frame.dispose();
    },
  };
}
