import { formatMessage, messages } from '../../i18n/index.js';
import type { PalisadePanelModel, UnitPanelModel } from '../details-panel/model/index.js';
import { GLYPH } from './icons.js';
import { button, element, setAttribute, setHidden, setTip, write } from './parts/dom.js';
import { createMeterRow } from './parts/meter-row.js';
import { createSection } from './parts/section.js';
import { createSegmented } from './parts/segmented.js';
import type { TipChip } from './parts/tip-layer.js';
import { createSelectionPanel } from './selection-panel.js';

type GateMode = 'open' | 'closed' | 'automatic';

export function createGatePanel(deps: {
  readonly plane: HTMLElement;
  readonly tooltip: TipChip;
  readonly close: () => void;
  readonly mode: (id: number, mode: GateMode) => void;
  readonly demolish: (id: number) => void;
}) {
  let shown: PalisadePanelModel | null = null;
  const frame = createSelectionPanel(
    deps.plane,
    {
      onBrowse: () => {},
      onOrders: () => {},
      onKickerDoubleClick: () => {},
      onRename: () => {},
      onClose: deps.close,
    },
    deps.tooltip,
  );
  frame.element.classList.add('on-gate-panel');
  const summary = element('div', 'on-gate-panel__summary');
  const art = element('span', 'on-gate-panel__art', GLYPH.gate);
  const state = element('strong', 'on-gate-panel__state');
  state.setAttribute('role', 'status');
  const health = createMeterRow();
  const section = createSection();
  const modes = createSegmented<GateMode>(['open', 'closed', 'automatic'], '', (mode) => {
    if (shown !== null && !shown.foreign && !shown.underConstruction) deps.mode(shown.entityId, mode);
  });
  const hint = element('p', 'on-gate-panel__hint');
  const demolish = button('on-medallion on-gate-panel__demolish', GLYPH.demolish);
  demolish.addEventListener('click', () => {
    if (shown !== null && !shown.foreign) deps.demolish(shown.entityId);
  });
  summary.append(art, state, demolish);
  frame.body.append(summary, health.element, section.element, modes.element, hint);
  return {
    update(model: UnitPanelModel): void {
      if (model.kind !== 'palisade' || model.gateOpen === null) {
        shown = null;
        frame.hide();
        return;
      }
      shown = model;
      const hud = messages().hud;
      const copy = hud.gatePanel;
      frame.updateHead({
        kicker: '',
        title: hud.gate,
        browse: null,
        rename: null,
        meta: null,
        orders: null,
        labels: { close: hud.settlerPanel.close, prev: hud.settlerPanel.prev, next: hud.settlerPanel.next },
      });
      write(state, model.gateOpen ? copy.passageOpen : copy.passageClosed);
      setAttribute(art, 'data-open', String(model.gateOpen));
      setHidden(health.element, model.health === null);
      if (model.health !== null) health.update({ ...model.health, tooltip: model.health.hover });
      section.update(copy.mode);
      const enabled = !model.foreign && !model.underConstruction;
      modes.update(
        {
          open: { label: copy.open, enabled },
          closed: { label: copy.closed, enabled },
          automatic: { label: copy.automatic, enabled },
        },
        model.gateMode,
        copy.mode,
      );
      const status = model.underConstruction
        ? formatMessage(hud.constructionProgress, { percent: model.builtPct })
        : model.gateMode === 'closed' && model.gateOpen
          ? copy.waiting
          : '';
      write(hint, status);
      setHidden(hint, status === '');
      setAttribute(demolish, 'aria-label', hud.demolishGate);
      setTip(demolish, hud.demolishGate);
      setHidden(demolish, model.foreign);
      frame.show();
    },
    claims: frame.claims,
    refreshTip: frame.refreshTip,
    dispose: frame.dispose,
  };
}
