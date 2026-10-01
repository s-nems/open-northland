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

/** A roster well (foundation.css `.on-roster__well`, 32 x 42 design px) shows its person a little larger
 *  than a crew seat; a vehicle fits itself to its double-width well. */
const ROSTER_FIT: WellFigureFit = { zoom: 0.66, feetInset: 6 };

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

/** The selected members as live wells, a health line under each; past three rows the grid scrolls in
 *  place. Only the wells in view are painted. */
export interface MemberRoster {
  readonly element: HTMLElement;
  update(members: readonly GroupMemberModel[]): void;
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
      ROSTER_FIT,
    );
    well.glyph.innerHTML = vehicle ? GLYPH.wheel : FIGURE.man;
    well.node.append(element('i', 'on-roster__health'));
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
    update(members): void {
      const copy = messages().hud.groupPanel;
      const key = members.map((member) => member.id).join(',');
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
      for (const { well, member } of order) {
        const health = member.healthPct;
        setStyleVar(well.node, '--value', `${health ?? 100}%`);
        setClass(well.node, 'on-roster__well--warn', member.tone === 'warn');
        setClass(well.node, 'on-roster__well--critical', member.tone === 'critical');
        const who =
          health === null
            ? formatMessage(copy.memberTooltipNoHealth, { name: member.name, type: member.kindLabel })
            : formatMessage(copy.memberTooltip, {
                name: member.name,
                type: member.kindLabel,
                health: `${health}%`,
              });
        setTip(well.node, `${who}\n${copy.memberHint}`);
      }
      updateMore();
    },
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
