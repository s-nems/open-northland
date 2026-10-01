import { formatMessage, messages } from '../../../i18n/index.js';
import { ALL_SCOPE, type GroupKindIcon, type GroupScopeModel } from '../../details-panel/model/index.js';
import { type GoodIconPainter, goodIconMarkup } from '../good-art.js';
import { FIGURE, GLYPH } from '../icons.js';
import { button, element, setAttribute, setClass, setTip, write } from '../parts/dom.js';

/** A tab's kind icon (design px): a weapon reads at the glyphs' size. */
const TAB_ICON_PX = 14;

/** What a press on a kind's tab does: show the kind, select only it, or drop it from the group. */
export type ScopePress = 'show' | 'narrow' | 'drop';

export function scopePress(scope: string, event: Pick<MouseEvent, 'detail' | 'shiftKey'>): ScopePress {
  if (scope === ALL_SCOPE) return 'show';
  if (event.shiftKey) return 'drop';
  return event.detail >= 2 ? 'narrow' : 'show';
}

const KIND_GLYPH: Readonly<Record<Extract<GroupKindIcon, { glyph: string }>['glyph'], string>> = {
  people: GLYPH.people,
  banner: GLYPH.banner,
  swords: GLYPH.swords,
  tool: GLYPH.tool,
  man: FIGURE.man,
  woman: FIGURE.woman,
  child: FIGURE.man,
  siege: GLYPH.crosshair,
  ship: GLYPH.anchor,
  cart: GLYPH.wheel,
};

function iconMarkup(icon: GroupKindIcon): string {
  if ('good' in icon) return goodIconMarkup(TAB_ICON_PX);
  const size = icon.glyph === 'child' ? 'on-scope__glyph on-scope__glyph--child' : 'on-scope__glyph';
  // The shared glyph gets the tab's own size class beside its own.
  const glyph = KIND_GLYPH[icon.glyph].replace(/class="(on-glyph|on-figure)"/, `class="$1 ${size}"`);
  return `<span class="on-scope__icon">${glyph}</span>`;
}

/** The kinds in the group as one line of tabs, the whole group first; a tab scopes the members, orders
 *  and gear below it. A tab names its kind while every name fits the line, else shows the kind's icon
 *  with its count. Hidden while the group holds one kind. */
export interface ScopeTabs {
  readonly element: HTMLElement;
  update(scopes: readonly GroupScopeModel[], open: string): void;
}

export function createScopeTabs(
  onPress: (scope: string, press: ScopePress) => void,
  icons: GoodIconPainter,
): ScopeTabs {
  const root = element('div', 'on-scopes');
  root.setAttribute('role', 'tablist');
  let shown = '';
  let measured = '';
  let tabs: { readonly key: string; readonly node: HTMLButtonElement }[] = [];
  return {
    element: root,
    update(scopes, open): void {
      const copy = messages().hud.groupPanel;
      setAttribute(root, 'aria-label', copy.tabs);
      root.hidden = scopes.length < 2;
      const key = scopes.map((scope) => scope.key).join(',');
      if (key !== shown) {
        shown = key;
        tabs = scopes.map((scope) => {
          const node = button(
            'on-scope',
            `${iconMarkup(scope.icon)}<span class="on-scope__label"></span><b class="on-scope__count"></b>`,
          );
          const frame = node.querySelector('.on-good__frame');
          if ('good' in scope.icon && frame instanceof HTMLElement)
            icons(frame, scope.icon.good, TAB_ICON_PX);
          node.setAttribute('role', 'tab');
          node.addEventListener('click', (event) => onPress(scope.key, scopePress(scope.key, event)));
          return { key: scope.key, node };
        });
        root.replaceChildren(...tabs.map((tab) => tab.node));
      }
      scopes.forEach((scope, index) => {
        const tab = tabs[index];
        if (tab === undefined) return;
        const label = tab.node.querySelector('.on-scope__label');
        const count = tab.node.querySelector('.on-scope__count');
        if (label !== null) write(label, scope.label);
        if (count !== null) write(count, String(scope.ids.length));
        setAttribute(tab.node, 'aria-selected', String(scope.key === open));
        setTip(
          tab.node,
          scope.key === ALL_SCOPE ? copy.allTooltip : formatMessage(copy.tabTooltip, { label: scope.label }),
        );
      });
      // Measured only when a name or a count changed: the names show unless they overflow the line.
      const text = scopes.map((scope) => `${scope.label} ${scope.ids.length}`).join('|');
      if (text !== measured && !root.hidden) {
        measured = text;
        setClass(root, 'on-scopes--icons', false);
        setClass(root, 'on-scopes--icons', root.scrollWidth > root.clientWidth);
      }
    },
  };
}
