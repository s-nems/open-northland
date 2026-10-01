import { formatMessage, messages } from '../../../i18n/index.js';
import type { GroupMemberModel } from '../../details-panel/model/index.js';
import type { FigureSlot } from '../../figures/live-figures.js';
import { FIGURE, GLYPH } from '../icons.js';
import { element, onPress, setClass, setStyleVar, setTip } from '../parts/dom.js';
import {
  createFigureWell,
  type FigureWell,
  FigureWellSlots,
  markDrawnWells,
  showInWell,
  type WellFigureFit,
} from '../parts/figure-well.js';

/** A roster well (foundation.css `.on-roster__well`, 32 x 46 design px) shows its person a little larger
 *  than a crew seat, feet above the two bars on its floor; a vehicle fits itself to its double-width well. */
const ROSTER_FIT: WellFigureFit = { zoom: 0.66, feetInset: 10 };
/** A compact well (`.on-roster--compact`, 24 x 34 design px), ten to a row, for a big list. */
const COMPACT_FIT: WellFigureFit = { zoom: 0.5, feetInset: 7 };
/** Past this many members in the group the wells turn compact, so a big army stays a few rows tall. */
export const ROSTER_COMPACT_ABOVE = 99;
/** Wells to a row, full size and compact (foundation.css `.on-roster`); a vehicle takes two. */
const ROSTER_COLUMNS = 8;
const COMPACT_COLUMNS = 10;
const VEHICLE_SPAN = 2;

/** The rows `members` fill in grid order: a vehicle that would cross the row's end starts the next. */
export function rosterRows(members: readonly GroupMemberModel[], columns: number): number {
  let rows = 0;
  let free = 0;
  for (const member of members) {
    const span = member.look === 'vehicle' ? VEHICLE_SPAN : 1;
    if (span > free) {
      rows += 1;
      free = columns;
    }
    free -= span;
  }
  return rows;
}

/** Ms a press waits for a second one before it selects the member alone, so a double press can bring the
 *  member into view without the panel giving way under the cursor first. Shorter than the platforms'
 *  double-click default, which would make every single press feel late. */
export const SELECT_ONLY_DELAY_MS = 300;

/** What a press on a member's well does. */
export type MemberPress = 'only' | 'centre' | 'drop' | 'kind';

export function memberPress(
  event: Pick<MouseEvent, 'detail' | 'shiftKey' | 'ctrlKey' | 'metaKey'>,
): MemberPress {
  if (event.shiftKey) return 'drop';
  if (event.ctrlKey || event.metaKey) return 'kind';
  return event.detail >= 2 ? 'centre' : 'only';
}

interface RosterWell {
  readonly well: FigureWell;
  member: GroupMemberModel;
}

/** The selected members as live wells, health and hunger lines under each; past the row cap the grid
 *  scrolls in place. Only the wells in view are painted. */
export interface MemberRoster {
  readonly element: HTMLElement;
  /** Show `members`, the tab's share of `group`; the well size follows the whole group, so a tab switch
   *  keeps it. */
  update(members: readonly GroupMemberModel[], group: readonly GroupMemberModel[]): void;
  /** The rows the whole group fills, the most the grid needs in any tab. */
  groupRows(): number;
  /** The wells in view, for the panel's figure painter; re-measured only after a scroll, a relist or a
   *  resize. */
  figureSlots(): readonly FigureSlot[];
  markDrawn(drawn: ReadonlySet<number>): void;
  /** The grid moved or changed size: the wells in view are measured again on the next frame. */
  invalidate(): void;
  /** The member under the cursor, whose ring the map lights; null while the cursor is elsewhere. */
  hovered(): number | null;
  /** The panel hid: a press still waiting to select its member is dropped, and nothing is hovered. */
  reset(): void;
}

export function createMemberRoster(
  onMember: (member: GroupMemberModel, press: MemberPress) => void,
): MemberRoster {
  const root = element('div', 'on-roster');
  const wells = new Map<number, RosterWell>();
  const slots = new FigureWellSlots();
  let order: readonly RosterWell[] = [];
  let shownKey = '';
  let inView: readonly FigureWell[] = [];
  let stale = true;
  let pending: { readonly id: number; readonly timer: ReturnType<typeof setTimeout> } | null = null;
  let hovered: number | null = null;
  let compact = false;
  let groupRows = 0;

  const settle = (): void => {
    if (pending === null) return;
    clearTimeout(pending.timer);
    pending = null;
  };
  const press = (entry: RosterWell, event: MouseEvent): void => {
    const kind = memberPress(event);
    settle();
    if (kind !== 'only') {
      onMember(entry.member, kind);
      return;
    }
    const id = entry.member.id;
    pending = {
      id,
      timer: setTimeout(() => {
        pending = null;
        onMember(entry.member, 'only');
      }, SELECT_ONLY_DELAY_MS),
    };
  };
  const wellOf = (member: GroupMemberModel): RosterWell => {
    const known = wells.get(member.id);
    if (known !== undefined) {
      known.member = member;
      return known;
    }
    const vehicle = member.look === 'vehicle';
    const well = createFigureWell(
      `on-seat-well on-roster__well${vehicle ? ' on-roster__well--vehicle' : ''}`,
      compact ? COMPACT_FIT : ROSTER_FIT,
    );
    well.glyph.innerHTML = vehicle ? GLYPH.wheel : FIGURE.man;
    well.node.append(
      element('i', 'on-roster__bar on-roster__bar--health'),
      element('i', 'on-roster__bar on-roster__bar--hunger'),
    );
    const entry: RosterWell = { well, member };
    onPress(well.node, (event) => press(entry, event));
    well.node.addEventListener('mouseenter', () => {
      hovered = entry.member.id;
    });
    well.node.addEventListener('mouseleave', () => {
      if (hovered === entry.member.id) hovered = null;
    });
    showInWell(well, member.id);
    wells.set(member.id, entry);
    return entry;
  };
  const updateMore = (): void => {
    setClass(root, 'on-roster--more', root.scrollTop + root.clientHeight < root.scrollHeight - 1);
  };
  root.addEventListener(
    'scroll',
    () => {
      stale = true;
      updateMore();
    },
    { passive: true },
  );

  return {
    element: root,
    update(members, group): void {
      const copy = messages().hud.groupPanel;
      const key = members.map((member) => member.id).join(',');
      const nextCompact = group.length > ROSTER_COMPACT_ABOVE;
      groupRows = rosterRows(group, nextCompact ? COMPACT_COLUMNS : ROSTER_COLUMNS);
      if (nextCompact !== compact) {
        // A well's figure fit is fixed when it is made, so the other size starts from new wells.
        compact = nextCompact;
        setClass(root, 'on-roster--compact', compact);
        settle();
        hovered = null;
        for (const entry of wells.values()) entry.well.node.remove();
        wells.clear();
        shownKey = '';
      }
      order = members.map(wellOf);
      if (key !== shownKey) {
        shownKey = key;
        const live = new Set(members.map((member) => member.id));
        for (const [id, entry] of wells) {
          if (live.has(id)) continue;
          if (pending?.id === id) settle();
          if (hovered === id) hovered = null;
          entry.well.node.remove();
          wells.delete(id);
        }
        root.replaceChildren(...order.map((entry) => entry.well.node));
        stale = true;
      }
      const hud = messages().hud;
      for (const { well, member } of order) {
        const { healthPct, hungerPct } = member;
        setClass(well.node, 'on-roster__well--no-health', healthPct === null);
        setClass(well.node, 'on-roster__well--no-hunger', hungerPct === null);
        if (healthPct !== null) setStyleVar(well.node, '--health', `${healthPct}%`);
        if (hungerPct !== null) setStyleVar(well.node, '--hunger', `${hungerPct}%`);
        const meters = [
          ...(healthPct === null
            ? []
            : [formatMessage(copy.memberMeter, { label: hud.health, pct: healthPct })]),
          ...(hungerPct === null
            ? []
            : [formatMessage(copy.memberMeter, { label: hud.hunger, pct: hungerPct })]),
        ];
        const who = formatMessage(copy.memberTooltip, { name: member.name, type: member.kindLabel });
        setTip(
          well.node,
          [who, ...(meters.length === 0 ? [] : [meters.join(' · ')]), copy.memberHint].join('\n'),
        );
      }
      updateMore();
    },
    groupRows: () => groupRows,
    figureSlots(): readonly FigureSlot[] {
      if (stale) {
        stale = false;
        const top = root.scrollTop;
        const bottom = top + root.clientHeight;
        inView = order
          .filter(
            ({ well }) => well.node.offsetTop < bottom && well.node.offsetTop + well.node.offsetHeight > top,
          )
          .map(({ well }) => well);
      }
      return slots.of(inView);
    },
    markDrawn: (drawn) => markDrawnWells(inView, drawn),
    invalidate(): void {
      stale = true;
      updateMore();
    },
    hovered: () => hovered,
    reset(): void {
      settle();
      hovered = null;
    },
  };
}
