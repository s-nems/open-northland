import { formatMessage, messages } from '../../../i18n/index.js';
import type { GroupGear, GroupGearRow, GroupScopeModel } from '../../details-panel/model/index.js';
import { goodIconMarkup } from '../good-art.js';
import { element, setHidden, setTip, write } from '../parts/dom.js';
import { createLedger } from '../parts/ledger.js';
import { createMeterRow, type MeterRow } from '../parts/meter-row.js';
import { createSection } from '../parts/section.js';
import { NEED_ORDER } from '../settler-panel/needs.js';
import type { GroupPanelDeps } from './actions.js';

/** A gear item's icon: a size between a ledger glyph and a socket, so a row of them reads at a glance. */
const GEAR_ICON_PX = 24;

const GEAR_LABEL: Readonly<Record<GroupGear, 'weapons' | 'armor' | 'tools' | 'bag'>> = {
  weapon: 'weapons',
  armor: 'armor',
  tool: 'tools',
  misc: 'bag',
};

/** One gear line: the slot's name, then every good held with its count, then how many hold none. */
function createGearLine(deps: GroupPanelDeps): { element: HTMLElement; update(row: GroupGearRow): void } {
  const root = element(
    'div',
    'on-gear',
    '<span class="on-gear__label"></span><span class="on-gear__items"></span>',
  );
  const [label, items] = [root.children[0], root.children[1]];
  if (!(label instanceof HTMLElement) || !(items instanceof HTMLElement))
    throw new Error('group gear: template');
  let shown = '';
  return {
    element: root,
    update(row): void {
      const copy = messages().hud.groupPanel;
      write(label, copy[GEAR_LABEL[row.gear]]);
      const key = `${row.items.map((item) => `${item.goodId}:${item.count}:${item.sips}`).join(',')}|${row.bare}`;
      if (key === shown) return;
      shown = key;
      const nodes = row.items.map((item) => {
        const node = element(
          'span',
          'on-gear__item',
          `${goodIconMarkup(GEAR_ICON_PX)}<b class="on-gear__count">${item.count}</b>`,
        );
        const frame = node.querySelector('.on-good__frame');
        if (item.goodId !== undefined && frame instanceof HTMLElement)
          deps.icons(frame, item.goodId, GEAR_ICON_PX);
        setTip(
          node,
          item.sips === null
            ? formatMessage(copy.itemTooltip, { good: item.label, count: item.count })
            : formatMessage(copy.itemSipsTooltip, { good: item.label, count: item.count, sips: item.sips }),
        );
        return node;
      });
      if (row.bare > 0) {
        const bare = element('span', 'on-gear__bare');
        write(bare, formatMessage(copy.bare, { count: row.bare }));
        setTip(bare, formatMessage(copy.bareTooltip, { count: row.bare }));
        nodes.push(bare);
      }
      items.replaceChildren(...nodes);
    },
  };
}

/** Przegląd: the scope's average health and needs (a need line orders it for everyone it reaches), what
 *  the scope wears and carries, and a vehicle crew's seats. */
export interface OverviewSection {
  readonly element: HTMLElement;
  update(scope: GroupScopeModel, orders: boolean): void;
}

export function createOverviewSection(
  deps: GroupPanelDeps,
  scope: () => GroupScopeModel | null,
): OverviewSection {
  const root = element('div', '');
  const title = createSection();
  const meters = element('div', '');
  const gear = element('div', 'on-gear-list');
  const crew = createLedger();
  root.append(title.element, meters, gear, crew.element);
  let meterKey = '';
  let rows: MeterRow[] = [];
  let tips: string[] = [];
  let hovered: { readonly index: number; readonly clientX: number; readonly clientY: number } | null = null;
  let gearKey = '';
  let lines: ReturnType<typeof createGearLine>[] = [];
  const showChip = (): void => {
    const tip = hovered === null ? undefined : tips[hovered.index];
    if (hovered === null || tip === undefined) deps.tooltip.hide();
    else deps.tooltip.show(hovered.clientX, hovered.clientY, tip);
  };
  const hover = (index: number, event: MouseEvent | null): void => {
    hovered = event === null ? null : { index, clientX: event.clientX, clientY: event.clientY };
    showChip();
  };
  return {
    element: root,
    update(model, orders): void {
      const copy = messages().hud.groupPanel;
      title.update(copy.overview);
      const health = model.health;
      const key = `${health === null ? '' : 'h'}|${model.needs.map((n) => n.need).join(',')}|${orders}`;
      if (key !== meterKey) {
        meterKey = key;
        hovered = null;
        deps.tooltip.hide();
        rows = [
          ...(health === null ? [] : [createMeterRow({ onHover: (event) => hover(0, event) })]),
          ...model.needs.map((need, at) => {
            const index = at + (health === null ? 0 : 1);
            return createMeterRow({
              ...(orders
                ? {
                    onPress: () => {
                      const ids = scope()?.ids ?? [];
                      deps.actions.orderNeed(ids, need.need);
                    },
                  }
                : {}),
              onHover: (event) => hover(index, event),
            });
          }),
        ];
        meters.replaceChildren(...rows.map((row) => row.element));
      }
      tips = [];
      let at = 0;
      if (health !== null) {
        const tip = formatMessage(copy.healthTooltip, {
          pct: health.pct,
          wounded: health.wounded,
          count: model.ids.length,
        });
        tips.push(tip);
        rows[at++]?.update({ label: messages().hud.health, pct: health.pct, tooltip: tip });
      }
      for (const need of model.needs) {
        const order = NEED_ORDER[need.need];
        const reach = orders ? deps.reach(order, model.ids) : 0;
        const tip =
          reach > 0
            ? formatMessage(copy.needTooltip, {
                pct: need.pct,
                order: messages().actionRing[order],
                reach,
                count: model.ids.length,
              })
            : formatMessage(copy.needTooltipNone, { pct: need.pct, order: messages().actionRing[order] });
        tips.push(tip);
        rows[at++]?.update({ label: need.label, pct: need.pct, tooltip: tip });
      }
      if (hovered !== null) showChip();

      const shape = model.gear.map((row) => row.gear).join(',');
      if (shape !== gearKey) {
        gearKey = shape;
        lines = model.gear.map(() => createGearLine(deps));
        gear.replaceChildren(...lines.map((line) => line.element));
      }
      model.gear.forEach((row, index) => {
        lines[index]?.update(row);
      });

      setHidden(crew.element, model.crew === null);
      if (model.crew !== null) {
        crew.update({
          label: copy.crew,
          tooltip: copy.crewTooltip,
          value: [{ text: formatMessage(copy.crewValue, model.crew) }],
        });
      }
    },
  };
}
