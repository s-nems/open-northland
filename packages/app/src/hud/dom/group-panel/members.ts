import { formatMessage, messages } from '../../../i18n/index.js';
import { type GroupMemberModel, MEAD_GOOD_ID } from '../../details-panel/model/index.js';
import type { FigureSlot } from '../../figures/live-figures.js';
import { type GoodIconPainter, goodIconMarkup } from '../good-art.js';
import { FIGURE, GLYPH } from '../icons.js';
import { element, onPress, setClass, setStyleVar, setTip } from '../parts/dom.js';
import { createFigureOverlay } from '../parts/figure-overlay.js';
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
const ROSTER_COMPACT_ABOVE = 99;
/** Wells to a row, full size and compact (foundation.css `.on-roster`); a vehicle takes two. */
const ROSTER_COLUMNS = 8;
const COMPACT_COLUMNS = 10;
const VEHICLE_SPAN = 2;
/** The mead badge in a well's top corner, full size and compact; its icon paints on the first bearer. */
const MEAD_BADGE_PX = 11;
const COMPACT_MEAD_BADGE_PX = 8;

/** Grid rows attached beyond each edge of the roster's view, so a wheel turn shows built wells at once. */
const ROW_MARGIN = 2;

/** The roster's grid order and each member's row in it. */
export interface RosterLayout {
  readonly members: readonly GroupMemberModel[];
  readonly rowOf: readonly number[];
  readonly rows: number;
}

/** Walk `members` in grid order, handing each its row, and answer the rows they fill. A vehicle that
 *  would cross a row's end waits while the members after it fill the row, then opens the next one, so a
 *  mixed list leaves no empty well before its last row. */
function walkRoster(
  members: readonly GroupMemberModel[],
  columns: number,
  visit: ((member: GroupMemberModel, row: number) => void) | null,
): number {
  // Allocated only when a vehicle has to wait.
  let waiting: GroupMemberModel[] | null = null;
  let row = -1;
  let free = 0;
  const place = (member: GroupMemberModel, span: number): void => {
    if (span > free) {
      row += 1;
      free = columns;
    }
    free -= span;
    visit?.(member, row);
  };
  for (const member of members) {
    const vehicle = member.look === 'vehicle';
    if (vehicle && free > 0 && free < VEHICLE_SPAN) {
      waiting ??= [];
      waiting.push(member);
      continue;
    }
    place(member, vehicle ? VEHICLE_SPAN : 1);
    while (waiting !== null && waiting.length > 0 && (free === 0 || free >= VEHICLE_SPAN))
      place(waiting.shift() as GroupMemberModel, VEHICLE_SPAN);
  }
  for (const member of waiting ?? []) place(member, VEHICLE_SPAN);
  return row + 1;
}

export function layRoster(members: readonly GroupMemberModel[], columns: number): RosterLayout {
  const order: GroupMemberModel[] = [];
  const rowOf: number[] = [];
  const rows = walkRoster(members, columns, (member, row) => {
    order.push(member);
    rowOf.push(row);
  });
  return { members: order, rowOf, rows };
}

/** The rows {@link layRoster} would fill, without building the layout. */
export function rosterRows(members: readonly GroupMemberModel[], columns: number): number {
  return walkRoster(members, columns, null);
}

/** A grid row's height and the gap under it, in design px. */
export interface RosterPitch {
  readonly row: number;
  readonly gap: number;
}

/** The rows a roster scrolled to `scrollTop` shows at least in part, `viewRows` tall, first and last;
 *  the arithmetic of a row's offset against the scroll box, so no frame reads the layout. */
export function rowsInView(
  pitch: RosterPitch,
  viewRows: number,
  scrollTop: number,
): { readonly first: number; readonly last: number } {
  const step = pitch.row + pitch.gap;
  // Unstyled (the roster is not on the page yet): every row counts as shown.
  if (step <= 0) return { first: 0, last: Number.MAX_SAFE_INTEGER };
  const bottom = scrollTop + viewRows * pitch.row + Math.max(0, viewRows - 1) * pitch.gap;
  // A row shows when its top is above the view's bottom and its bottom below the view's top.
  const first = Math.max(0, Math.floor((scrollTop - pitch.row) / step) + 1);
  const last = Math.ceil(bottom / step) - 1;
  return { first, last };
}

/** Make `nodes` the children of `parent` in order, moving only the ones out of place: a member that
 *  changed kind or a scroll by a row moves a few wells, and every other well keeps its layout box,
 *  which replacing the children would tear down and build again. */
export function layChildren(parent: Element, nodes: readonly Element[]): void {
  const kept = new Set(nodes);
  for (const child of [...parent.children]) if (!kept.has(child)) child.remove();
  let at = parent.firstElementChild;
  for (const node of nodes) {
    // The node here is wanted further on, as when a member moved down the list: it leaves until its
    // place comes, instead of every node before that place moving up past it.
    if (at !== null && node !== at && node === at.nextElementSibling) {
      at.remove();
      at = node;
    }
    if (node === at) at = node.nextElementSibling;
    else parent.insertBefore(node, at);
  }
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
  readonly mead: HTMLElement;
  meadPainted: boolean;
  member: GroupMemberModel;
  /** The member as its bars and tooltip last showed it; a rebuild skips a well whose member held. */
  shown: GroupMemberModel | null;
}

const sameShown = (a: GroupMemberModel, b: GroupMemberModel): boolean =>
  a.healthPct === b.healthPct &&
  a.hungerPct === b.hungerPct &&
  a.name === b.name &&
  a.kindLabel === b.kindLabel &&
  a.carriesMead === b.carriesMead;

/** The selected members as live wells, health and hunger lines under each and a mead badge on a bearer;
 *  past the row cap the grid scrolls in place. Only the wells in view are painted. */
export interface MemberRoster {
  readonly element: HTMLElement;
  /** Show `members`, the tab's share of `group`; the well size follows the whole group, so a tab switch
   *  keeps it. */
  update(members: readonly GroupMemberModel[], group: readonly GroupMemberModel[]): void;
  /** The rows the whole group fills, the most the grid needs in any tab. */
  groupRows(): number;
  /** Show `rows` grid rows; the rest of the members scroll. */
  setRows(rows: number): void;
  /** The wells in view, for the panel's figure painter; re-measured only after a scroll, a relist or a
   *  resize. */
  figureSlots(): readonly FigureSlot[];
  /** After the figures' paint: mark the wells drawn and copy the `repainted` canvases onto the
   *  roster's figure canvas. */
  markDrawn(drawn: ReadonlySet<number>, repainted: ReadonlySet<HTMLCanvasElement>): void;
  /** The grid moved or changed size: the wells in view are measured again on the next frame. */
  invalidate(): void;
  /** The member under the cursor, whose ring the map lights; null while the cursor is elsewhere. */
  hovered(): number | null;
  /** The panel hid: a press still waiting to select its member is dropped, and nothing is hovered. */
  reset(): void;
}

/**
 * The roster holds a well only for the members in and near its view, between two spacers that span the
 * rows above and below, so the grid keeps the whole list's scroll height while a big army costs the
 * page, its style passes and its hit tests a few rows of wells. Each spacer spans whole rows, so the
 * attached wells take the grid places they would take in the full list.
 */
export function createMemberRoster(
  onMember: (member: GroupMemberModel, press: MemberPress) => void,
  icons: GoodIconPainter,
): MemberRoster {
  const root = element('div', 'on-roster');
  // The wells paint off the page; this canvas over them shows their copies.
  const figures = createFigureOverlay('on-roster__figures');
  const padTop = element('i', 'on-roster__pad');
  const padBottom = element('i', 'on-roster__pad');
  /** The wells built for members still in the group, attached or not. */
  const wells = new Map<number, RosterWell>();
  const slots = new FigureWellSlots();
  /** The tab's members in grid order, each one's row, and the rows they fill. */
  let listed: readonly GroupMemberModel[] = [];
  let rowOf: readonly number[] = [];
  let listedRows = 0;
  /** The attached rows, both ends inclusive. */
  let attached = { first: 0, last: -1 };
  let viewRows = 0;
  let scrollTop = 0;
  /** The next relist reads the box's scroll, which a hidden roster lost; otherwise scrolls keep it. */
  let rescroll = true;
  let pitch: RosterPitch | null = null;
  let shownKey = '';
  let inView: readonly FigureWell[] = [];
  /** The in-view wells' slots as last measured, and the device scale they were measured at. */
  let measuredSlots: readonly FigureSlot[] | null = null;
  let measuredRatio = 0;
  let stale = true;
  /** The attached wells moved, so the figure canvas is placed and filled again after the next paint. */
  let figuresStale = true;
  /** The wells laid in the grid, in grid order. */
  let attachedWells: readonly FigureWell[] = [];
  let pending: { readonly id: number; readonly timer: ReturnType<typeof setTimeout> } | null = null;
  let hovered: number | null = null;
  let compact = false;
  let groupRows = 0;
  let shownCopy: ReturnType<typeof messages>['hud'] | null = null;

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

  /** Write the well's bars, badge and tooltip when its member's shown values changed. */
  const writeWell = (entry: RosterWell): void => {
    const { well, member } = entry;
    if (entry.shown !== null && sameShown(entry.shown, member)) return;
    entry.shown = member;
    const copy = messages().hud.groupPanel;
    const hud = messages().hud;
    const { healthPct, hungerPct } = member;
    setClass(well.node, 'on-roster__well--no-health', healthPct === null);
    setClass(well.node, 'on-roster__well--no-hunger', hungerPct === null);
    if (healthPct !== null) setStyleVar(well.node, '--health', `${healthPct}%`);
    if (hungerPct !== null) setStyleVar(well.node, '--hunger', `${hungerPct}%`);
    entry.mead.hidden = !member.carriesMead;
    const frame = member.carriesMead && !entry.meadPainted && entry.mead.querySelector('.on-good__frame');
    if (frame instanceof HTMLElement) {
      entry.meadPainted = true;
      icons(frame, MEAD_GOOD_ID, compact ? COMPACT_MEAD_BADGE_PX : MEAD_BADGE_PX);
    }
    const meters = [
      ...(healthPct === null ? [] : [formatMessage(copy.memberMeter, { label: hud.health, pct: healthPct })]),
      ...(hungerPct === null ? [] : [formatMessage(copy.memberMeter, { label: hud.hunger, pct: hungerPct })]),
    ];
    const who = formatMessage(copy.memberTooltip, { name: member.name, type: member.kindLabel });
    setTip(
      well.node,
      [who, ...(meters.length === 0 ? [] : [meters.join(' · ')]), copy.memberHint].join('\n'),
    );
  };

  const wellOf = (member: GroupMemberModel): RosterWell => {
    // A known well keeps the member the last update gave it; `listed` may hold an older model.
    const known = wells.get(member.id);
    if (known !== undefined) {
      return known;
    }
    const vehicle = member.look === 'vehicle';
    const well = createFigureWell(
      `on-seat-well on-roster__well${vehicle ? ' on-roster__well--vehicle' : ''}`,
      compact ? COMPACT_FIT : ROSTER_FIT,
    );
    // The figure is painted off the page and copied onto the roster's canvas; a canvas left in the
    // document would make each paint bring the page's style up to date first.
    well.canvas.remove();
    well.glyph.innerHTML = vehicle ? GLYPH.wheel : FIGURE.man;
    const mead = element('span', 'on-roster__mead');
    mead.innerHTML = goodIconMarkup(compact ? COMPACT_MEAD_BADGE_PX : MEAD_BADGE_PX);
    mead.hidden = true;
    well.node.append(
      element('i', 'on-roster__bar on-roster__bar--health'),
      element('i', 'on-roster__bar on-roster__bar--hunger'),
      mead,
    );
    const entry: RosterWell = { well, mead, meadPainted: false, member, shown: null };
    onPress(well.node, (event) => press(entry, event));
    well.node.addEventListener('mouseenter', () => {
      hovered = entry.member.id;
    });
    well.node.addEventListener('mouseleave', () => {
      if (hovered === entry.member.id) hovered = null;
    });
    showInWell(well, member.id);
    wells.set(member.id, entry);
    writeWell(entry);
    return entry;
  };

  /** The grid's row pitch from its styles, read again when the well size changes; not kept while the
   *  roster is off the page and unstyled. */
  const pitchOf = (): RosterPitch => {
    if (pitch !== null) return pitch;
    const style = getComputedStyle(root);
    const read = {
      row: Number.parseFloat(style.gridAutoRows) || 0,
      gap: Number.parseFloat(style.rowGap) || 0,
    };
    if (read.row > 0) pitch = read;
    return read;
  };
  /** The scroll a list of `listedRows` rows can hold: a shorter list clamps it, as the browser does. */
  const heightOf = (rows: number): number => {
    const { row, gap } = pitchOf();
    return rows * row + Math.max(0, rows - 1) * gap;
  };
  const clampedScroll = (): number =>
    Math.min(scrollTop, Math.max(0, heightOf(listedRows) - heightOf(viewRows)));
  const updateMore = (): void => {
    setClass(root, 'on-roster--more', clampedScroll() + heightOf(viewRows) < heightOf(listedRows) - 1);
  };
  const spanRows = (pad: HTMLElement, rows: number): HTMLElement | null => {
    if (rows <= 0) return null;
    const span = `span ${rows}`;
    if (pad.style.gridRow !== span) pad.style.gridRow = span;
    return pad;
  };

  /** Attach the wells of the rows in and near the view; `relisted` lays them again although the rows
   *  held. */
  const attach = (relisted: boolean): void => {
    const view = rowsInView(pitchOf(), viewRows, clampedScroll());
    const first = Math.max(0, view.first - ROW_MARGIN);
    const last = Math.min(listedRows - 1, view.last + ROW_MARGIN);
    if (!relisted && first === attached.first && last === attached.last) return;
    attached = { first, last };
    const nodes: HTMLElement[] = [];
    const top = spanRows(padTop, first);
    if (top !== null) nodes.push(top);
    const laid: FigureWell[] = [];
    listed.forEach((member, index) => {
      const row = rowOf[index] as number;
      if (row < first || row > last) return;
      const { well } = wellOf(member);
      laid.push(well);
      nodes.push(well.node);
    });
    attachedWells = laid;
    const bottom = spanRows(padBottom, listedRows - last - 1);
    if (bottom !== null) nodes.push(bottom);
    nodes.push(figures.canvas);
    // Laying a well again drops its focus; hand it back without moving the scroll.
    const focused = document.activeElement;
    layChildren(root, nodes);
    if (focused instanceof HTMLElement && focused !== document.activeElement && root.contains(focused))
      focused.focus({ preventScroll: true });
    // A well detached under the cursor gets no mouseleave, so its hover ends here.
    if (hovered !== null && !root.contains(wells.get(hovered)?.well.node ?? null)) hovered = null;
    stale = true;
    figuresStale = true;
  };

  root.addEventListener(
    'scroll',
    () => {
      scrollTop = root.scrollTop;
      // The figure canvas scrolls with the wells; only a re-attach (which marks it) lays it again.
      attach(false);
      stale = true;
      updateMore();
    },
    { passive: true },
  );

  return {
    element: root,
    update(members, group): void {
      const key = members.map((member) => member.id).join(',');
      const nextCompact = group.length > ROSTER_COMPACT_ABOVE;
      groupRows = rosterRows(group, nextCompact ? COMPACT_COLUMNS : ROSTER_COLUMNS);
      if (nextCompact !== compact) {
        // A well's figure fit is fixed when it is made, so the other size starts from new wells.
        compact = nextCompact;
        setClass(root, 'on-roster--compact', compact);
        pitch = null;
        settle();
        hovered = null;
        for (const entry of wells.values()) entry.well.node.remove();
        wells.clear();
        shownKey = '';
      }
      const hud = messages().hud;
      // Another language words every tooltip anew.
      if (hud !== shownCopy) {
        shownCopy = hud;
        for (const entry of wells.values()) entry.shown = null;
      }
      if (key !== shownKey) {
        shownKey = key;
        if (rescroll) scrollTop = root.scrollTop;
        rescroll = false;
        const live = new Set(members.map((member) => member.id));
        for (const [id, entry] of wells) {
          if (live.has(id)) continue;
          if (pending?.id === id) settle();
          if (hovered === id) hovered = null;
          entry.well.node.remove();
          wells.delete(id);
        }
        const layout = layRoster(members, compact ? COMPACT_COLUMNS : ROSTER_COLUMNS);
        // A member's look is fixed by its id, so the layout holds until the ids change.
        listed = layout.members;
        rowOf = layout.rowOf;
        listedRows = layout.rows;
        // A shorter list clamps the box's scroll; the next rows follow the clamped offset.
        scrollTop = clampedScroll();
        attach(true);
        updateMore();
      }
      for (const member of members) {
        const entry = wells.get(member.id);
        if (entry === undefined) continue;
        entry.member = member;
        writeWell(entry);
      }
    },
    groupRows: () => groupRows,
    setRows(rows): void {
      if (rows === viewRows) return;
      viewRows = rows;
      setStyleVar(root, '--roster-rows', String(rows));
      attach(false);
      stale = true;
      figuresStale = true;
      updateMore();
    },
    figureSlots(): readonly FigureSlot[] {
      if (stale) {
        stale = false;
        const view = rowsInView(pitchOf(), viewRows, clampedScroll());
        const shown: FigureWell[] = [];
        listed.forEach((member, index) => {
          const row = rowOf[index] as number;
          const entry = row >= view.first && row <= view.last ? wells.get(member.id) : undefined;
          if (entry !== undefined) shown.push(entry.well);
        });
        inView = shown;
        measuredSlots = null;
      }
      // Measured again only after a change, on another display or until the wells are laid out:
      // measuring reads the layout, which the frame's HUD writes have dirtied by now.
      if (measuredSlots === null || measuredSlots.length === 0 || measuredRatio !== devicePixelRatio) {
        // Another device scale resizes the wells' canvases, so the figure canvas is laid again too.
        if (measuredRatio !== devicePixelRatio) figuresStale = true;
        measuredSlots = slots.of(inView);
        measuredRatio = devicePixelRatio;
      }
      return measuredSlots;
    },
    markDrawn: (drawn, repainted) => {
      markDrawnWells(inView, drawn);
      if (figuresStale) {
        figuresStale = false;
        figures.place(attachedWells);
      } else figures.copy(repainted);
    },
    invalidate(): void {
      stale = true;
      figuresStale = true;
      updateMore();
    },
    hovered: () => hovered,
    reset(): void {
      settle();
      hovered = null;
      // A hidden roster loses its scroll, so the next showing lays the list again from the box's own.
      shownKey = '';
      rescroll = true;
    },
  };
}
