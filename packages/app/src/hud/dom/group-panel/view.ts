import { formatMessage, messages } from '../../../i18n/index.js';
import {
  ALL_SCOPE,
  type GroupMemberModel,
  type GroupPanelModel,
  type GroupScopeModel,
  type UnitPanelModel,
} from '../../details-panel/model/index.js';
import { type FigureSlot, NO_FIGURE_SLOTS } from '../../figures/live-figures.js';
import { setClass } from '../parts/dom.js';
import { createSection } from '../parts/section.js';
import { createSelectionPanel, type SelectionHeadModel } from '../selection-panel.js';
import type { GroupPanelDeps } from './actions.js';
import { createDetailsSection } from './details.js';
import { createMemberRoster, type MemberPress } from './members.js';
import { createGroupMilitarySection } from './military.js';
import { createOverviewSection } from './overview.js';
import { createScopeTabs, type ScopePress } from './tabs.js';

/** Several units selected at once on the DOM plane (FOUNDATION.md, "Group panel"). */
export interface GroupPanel {
  /** Show the model when it is a group, else hide. */
  update(model: UnitPanelModel): void;
  hide(): void;
  claims(clientX: number, clientY: number): boolean;
  invalidate(): void;
  /** Once a frame, after the paint: a refit after the plane or a section changed size, and a shown tip
   *  follows its control. */
  refresh(): void;
  /** The roster wells in view, which the owner paints live every frame; none while hidden. */
  figureSlots(): readonly FigureSlot[];
  markDrawn(drawn: ReadonlySet<number>): void;
  /** The member whose well the cursor is on, for the map to light its ring; null while hidden. */
  focused(): number | null;
  /** Paint once at map start, so the first group costs no first-paint work. */
  warm(): void;
  dispose(): void;
}

/** The roster's heights, tallest first: the grid gives up rows before the details fold. */
const ROSTER_ROWS = [3, 2, 1] as const;

function groupHead(model: GroupPanelModel, ordersKey: string): SelectionHeadModel {
  const copy = messages().hud.settlerPanel;
  return {
    kicker: messages().hud.groupPanel.kicker,
    browse: null,
    title: model.title,
    rename: null,
    meta: null,
    orders: model.orders ? { tooltip: formatMessage(copy.ordersTooltip, { key: ordersKey }) } : null,
    labels: { close: copy.close, prev: copy.prev, next: copy.next },
  };
}

/** A small group for the warm-up paint, never shown. */
function warmModel(): GroupPanelModel {
  const member = (id: number, look: GroupMemberModel['look']): GroupMemberModel => ({
    id,
    look,
    kind: look,
    name: '',
    kindLabel: '',
    healthPct: 100,
    tone: 'ok',
  });
  const scope = (key: string, ids: readonly number[]): GroupScopeModel => ({
    key,
    label: key,
    ids,
    health: { pct: 100, wounded: 0 },
    needs: [],
    gear: [],
    crew: null,
    military: {
      count: ids.length,
      stance: null,
      stances: { attack: 0, defend: 0, ignore: 0 },
      regeneration: true,
    },
    siege: null,
    details: [],
  });
  return {
    kind: 'group',
    title: '',
    members: [member(-1, 'settler'), member(-2, 'vehicle')],
    scopes: [scope(ALL_SCOPE, [-1, -2]), scope('settler', [-1]), scope('vehicle', [-2])],
    orders: true,
  };
}

export function createGroupPanel(deps: GroupPanelDeps): GroupPanel {
  const { actions } = deps;
  let shown: GroupPanelModel | null = null;
  let open = ALL_SCOPE;
  const scope = (): GroupScopeModel | null =>
    shown?.scopes.find((s) => s.key === open) ?? shown?.scopes[0] ?? null;

  const frame = createSelectionPanel(
    deps.plane,
    {
      onBrowse: () => {},
      onOrders: (press) => actions.openOrders(press),
      onKickerDoubleClick: () => {},
      onRename: () => {},
      onClose: () => actions.clearSelection(),
    },
    deps.tooltip,
  );
  frame.element.addEventListener('mousedown', (event) => {
    if (event.button === 0) actions.closeOrders();
  });

  const onScope = (key: string, press: ScopePress): void => {
    const model = shown;
    const picked = model?.scopes.find((s) => s.key === key);
    if (model === null || picked === undefined) return;
    if (press === 'narrow') {
      actions.select(picked.ids);
      return;
    }
    if (press === 'drop') {
      const dropped = new Set(picked.ids);
      actions.select(model.members.filter((m) => !dropped.has(m.id)).map((m) => m.id));
      return;
    }
    open = key;
    paint(model, false);
  };
  const onMember = (member: GroupMemberModel, press: MemberPress): void => {
    const model = shown;
    if (model === null) return;
    switch (press) {
      case 'only':
        actions.selectOnly(member.id);
        return;
      case 'centre':
        actions.centre(member.id);
        return;
      case 'drop':
        actions.select(model.members.filter((m) => m.id !== member.id).map((m) => m.id));
        return;
      case 'kind':
        actions.select(model.members.filter((m) => m.kind === member.kind).map((m) => m.id));
        return;
    }
  };

  const tabs = createScopeTabs(onScope);
  const rosterTitle = createSection();
  const roster = createMemberRoster(onMember);
  const overview = createOverviewSection(deps, scope);
  const military = createGroupMilitarySection(deps, scope);
  /** The player opened the details on this group, so the fit leaves them open. */
  let playerOpened = false;
  const details = createDetailsSection(deps, () => {
    playerOpened = true;
  });
  frame.body.append(
    tabs.element,
    rosterTitle.element,
    roster.element,
    overview.element,
    military.element,
    details.element,
  );

  /** Fit the panel to the plane: the roster gives up rows first, then the open details step aside. A
   *  details section the player opened while squeezed stays open and only takes rows from the roster,
   *  until the next group. */
  const fit = (fresh: boolean): void => {
    if (fresh) playerOpened = false;
    details.unsqueeze();
    for (const rows of ROSTER_ROWS) {
      for (const each of ROSTER_ROWS) setClass(roster.element, `on-roster--rows${each}`, each === rows);
      if (frame.overflow() === 0) break;
    }
    if (!playerOpened && frame.overflow() > 0) details.squeeze();
    roster.invalidate();
  };
  let refit = false;
  const resizes = new ResizeObserver(() => {
    refit = true;
  });
  for (const node of [frame.body, tabs.element, overview.element, military.element, details.element]) {
    resizes.observe(node);
  }

  const paint = (model: GroupPanelModel, fresh: boolean): void => {
    const current = scope();
    if (current === null) return;
    const copy = messages().hud.groupPanel;
    tabs.update(model.scopes, current.key);
    rosterTitle.update(copy.members);
    const ids = new Set(current.ids);
    roster.update(current.key === ALL_SCOPE ? model.members : model.members.filter((m) => ids.has(m.id)));
    overview.update(current, model.orders);
    military.update(current, model.orders);
    details.update(current);
    // Later value changes refit through the resize observer, when a section actually changed height.
    if (fresh) fit(true);
  };

  const hide = (): void => {
    if (shown === null) return;
    shown = null;
    open = ALL_SCOPE;
    roster.reset();
    deps.tooltip.hide();
    frame.hide();
  };

  return {
    update(model): void {
      if (model.kind !== 'group') {
        hide();
        return;
      }
      const before = shown;
      const fresh =
        before === null ||
        before.members.length !== model.members.length ||
        before.members.some((member, index) => model.members[index]?.id !== member.id);
      shown = model;
      // A kind that left the group takes its tab with it; the whole group shows instead.
      if (!model.scopes.some((s) => s.key === open)) open = ALL_SCOPE;
      frame.updateHead(groupHead(model, deps.keyLabel('actionRing')));
      // Shown before the sections: the fit's overflow read needs the frame laid out.
      frame.show();
      paint(model, fresh);
    },
    hide,
    claims: (clientX, clientY) => frame.claims(clientX, clientY),
    invalidate(): void {
      frame.invalidate();
      roster.invalidate();
    },
    refresh(): void {
      frame.refreshTip();
      if (!refit || shown === null) return;
      refit = false;
      fit(false);
    },
    figureSlots: () => (shown === null ? NO_FIGURE_SLOTS : roster.figureSlots()),
    markDrawn: (drawn) => roster.markDrawn(drawn),
    focused: () => (shown === null ? null : roster.hovered()),
    warm(): void {
      const model = warmModel();
      shown = model;
      frame.updateHead(groupHead(model, deps.keyLabel('actionRing')));
      paint(model, true);
      frame.warm();
      shown = null;
    },
    dispose(): void {
      roster.reset();
      resizes.disconnect();
      frame.dispose();
    },
  };
}
