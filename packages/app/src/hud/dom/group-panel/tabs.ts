import { formatMessage, messages } from '../../../i18n/index.js';
import { ALL_SCOPE, type GroupScopeModel } from '../../details-panel/model/index.js';
import { button, element, setAttribute, setTip, write } from '../parts/dom.js';

/** What a press on a kind's tab does: show the kind, select only it, or drop it from the group. */
export type ScopePress = 'show' | 'narrow' | 'drop';

export function scopePress(scope: string, event: Pick<MouseEvent, 'detail' | 'shiftKey'>): ScopePress {
  if (scope === ALL_SCOPE) return 'show';
  if (event.shiftKey) return 'drop';
  return event.detail >= 2 ? 'narrow' : 'show';
}

/** The kinds in the group as tabs, the whole group first; a tab scopes the members, stats and orders
 *  below it. Hidden while the group holds one kind. */
export interface ScopeTabs {
  readonly element: HTMLElement;
  update(scopes: readonly GroupScopeModel[], open: string): void;
}

export function createScopeTabs(onPress: (scope: string, press: ScopePress) => void): ScopeTabs {
  const root = element('div', 'on-scopes');
  root.setAttribute('role', 'tablist');
  let shown = '';
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
          const node = button('on-scope', '<span></span><b class="on-scope__count"></b>');
          node.setAttribute('role', 'tab');
          node.addEventListener('click', (event) => onPress(scope.key, scopePress(scope.key, event)));
          return { key: scope.key, node };
        });
        root.replaceChildren(...tabs.map((tab) => tab.node));
      }
      scopes.forEach((scope, index) => {
        const tab = tabs[index];
        if (tab === undefined) return;
        const [label, count] = [tab.node.children[0], tab.node.children[1]];
        if (label !== undefined) write(label, scope.label);
        if (count !== undefined) write(count, String(scope.ids.length));
        setAttribute(tab.node, 'aria-selected', String(scope.key === open));
        setTip(
          tab.node,
          scope.key === ALL_SCOPE ? copy.allTooltip : formatMessage(copy.tabTooltip, { label: scope.label }),
        );
      });
    },
  };
}
