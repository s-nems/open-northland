import { formatMessage, messages } from '../../../i18n/index.js';
import type { GroupGear, GroupGearRow, GroupScopeModel } from '../../details-panel/model/index.js';
import { goodIconMarkup } from '../good-art.js';
import { button, element, setAttribute, setHidden, setTip, write } from '../parts/dom.js';
import { createSection } from '../parts/section.js';
import type { GroupPanelDeps } from './actions.js';

/** A gear item's icon: a cargo well's size less a step, so the foot reads as a summary under the roster. */
const GEAR_ICON_PX = 16;
/** Goods a line shows before the rest fold into a "+N" chip: three icons with a "bez: N" fill the line,
 *  so a line never wraps and a tab switch never changes its height. */
const GEAR_ITEMS_SHOWN = 3;

const GEAR_LABEL: Readonly<Record<GroupGear, 'weapons' | 'armor' | 'boots' | 'tools' | 'equipment'>> = {
  weapon: 'weapons',
  armor: 'armor',
  boots: 'boots',
  tool: 'tools',
  misc: 'equipment',
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
      const folded = row.items.length > GEAR_ITEMS_SHOWN;
      const shownItems = folded ? row.items.slice(0, GEAR_ITEMS_SHOWN - 1) : row.items;
      const nodes = shownItems.map((item) => {
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
      if (folded) {
        const rest = row.items.slice(shownItems.length);
        const more = element('span', 'on-gear__more');
        write(more, formatMessage(copy.moreGoods, { count: rest.length }));
        setTip(
          more,
          rest
            .map((item) => formatMessage(copy.itemTooltip, { good: item.label, count: item.count }))
            .join('\n'),
        );
        nodes.push(more);
      }
      if (row.items.length === 0 && row.bare === 0) {
        // The group has this line but the tab holds nobody it is for.
        const none = element('span', 'on-gear__bare');
        write(none, copy.gearNone);
        setTip(none, copy.gearNoneTooltip);
        nodes.push(none);
      }
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

/** Przegląd, at the panel's foot: what the scope wears and carries, one compact line per slot. Folded
 *  under its title on a new map; the player's open or fold press holds for every group until the next. */
export interface OverviewSection {
  readonly element: HTMLElement;
  update(scope: GroupScopeModel): void;
}

export function createOverviewSection(deps: GroupPanelDeps): OverviewSection {
  const toggle = button('on-more');
  const title = createSection(toggle);
  const gear = element('div', 'on-gear-list');
  const root = element('div', '');
  root.append(title.element, gear);
  let open = false;
  const paintToggle = (): void => {
    const copy = messages().hud.groupPanel;
    write(toggle, open ? copy.overviewHide : copy.overviewShow);
    setAttribute(toggle, 'aria-expanded', String(open));
    setHidden(gear, !open);
  };
  toggle.addEventListener('click', () => {
    open = !open;
    paintToggle();
  });
  let gearKey = '';
  let lines: ReturnType<typeof createGearLine>[] = [];
  return {
    element: root,
    update(model): void {
      setHidden(root, model.gear.length === 0);
      title.update(messages().hud.groupPanel.overview);
      paintToggle();
      const shape = model.gear.map((row) => row.gear).join(',');
      if (shape !== gearKey) {
        gearKey = shape;
        lines = model.gear.map(() => createGearLine(deps));
        gear.replaceChildren(...lines.map((line) => line.element));
      }
      model.gear.forEach((row, index) => {
        lines[index]?.update(row);
      });
    },
  };
}
