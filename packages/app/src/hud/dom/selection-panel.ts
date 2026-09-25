import { navBeamRect } from '../nav-beam.js';
import { TOP_BAR_HEIGHT } from '../regions.js';
import { GLYPH } from './icons.js';
import { button, element, setAttribute, setHidden, setTitle, write } from './parts/dom.js';
import { WINDOW_ORNAMENTS } from './symbols.js';

/** Design px between the summary bar and the panel's top when the panel is as tall as it gets. */
const SELECTION_TOP_GAP_PX = 16;
/** The panel's design-px width (FOUNDATION.md). */
export const SELECTION_PANEL_W = 318;
/** The panel painted out of sight for its warm-up frame (foundation.css). */
const WARM_CLASS = 'on-selection--warm';

/** Design px the panel stands above the plane's bottom: the beam's height when the beam reaches under
 *  the panel's column on a narrow plane, else none. */
export function selectionBottomInset(plane: { readonly width: number; readonly height: number }): number {
  const beam = navBeamRect(plane, 1);
  return beam.x + beam.w > plane.width - SELECTION_PANEL_W ? beam.h : 0;
}

/** The head of the selected thing: the kicker (with browsing), the title (with rename), the meta line,
 *  and the medallions: the gold orders one, when the thing takes orders, beside the close. */
export interface SelectionHeadModel {
  readonly kicker: string;
  /** The chevrons and "i / n" over the kicker's peers; null shows the kicker alone. */
  readonly browse: {
    readonly index: number;
    readonly count: number;
    readonly prevTooltip: string;
    readonly nextTooltip: string;
    readonly kickerTooltip: string;
  } | null;
  readonly title: string;
  /** The pen's tooltip and the longest name the field takes; null keeps the title read-only. */
  readonly rename: { readonly tooltip: string; readonly maxLength: number } | null;
  readonly meta: string | null;
  /** The orders medallion's tooltip, which names the ring's hotkey; null leaves the close alone. */
  readonly orders: { readonly tooltip: string } | null;
  readonly labels: {
    readonly close: string;
    readonly prev: string;
    readonly next: string;
  };
}

/** Where the orders medallion was pressed, in client (CSS) px, with the panel's left edge, so the ring
 *  opens beside the cursor without an arm under the panel. */
export interface OrdersPress {
  readonly x: number;
  readonly y: number;
  readonly panelLeft: number;
}

export interface SelectionPanelHandlers {
  readonly onBrowse: (step: 1 | -1) => void;
  readonly onOrders: (press: OrdersPress) => void;
  readonly onKickerDoubleClick: () => void;
  /** The name the player typed and confirmed, trimmed; an empty one asks for the default name back. */
  readonly onRename: (name: string) => void;
  readonly onClose: () => void;
}

/** The part of the canvas the panel leaves open for the renderer, in client (CSS) px. */
export interface ClientRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The bottom-right selection window (FOUNDATION.md, "Settler panel"): framed like the other windows,
 * as tall as its content up to the summary bar and never scrolled. Its owner fills `body` and says
 * which element in it the renderer paints through: the fill leaves a hole there, since the plane lies
 * over the canvas.
 */
export interface SelectionPanel {
  readonly element: HTMLElement;
  readonly body: HTMLElement;
  show(): void;
  hide(): void;
  isOpen(): boolean;
  updateHead(model: SelectionHeadModel): void;
  /** The frame the fill opens a hole under (its padding box), or null for none. */
  setHole(frame: HTMLElement | null): void;
  /** The content, the scale or the screen changed: the hole is measured again on the next read. */
  invalidate(): void;
  /**
   * Paint the panel once, out of sight, and hide it again after the frame: the browser compiles a
   * raster pipeline the first time a style combination is drawn, which this moves from the first
   * selection to map start (measured at hundreds of ms on the first settler click). A real `show`
   * during the frame keeps the panel.
   */
  warm(): void;
  /** The hole's client box, measured once per change; null while closed or holeless. */
  holeClientRect(): ClientRect | null;
  /** True when this client point is over the panel. */
  claims(clientX: number, clientY: number): boolean;
  /** The name field is open, so the owner leaves the title alone. */
  renaming(): boolean;
  dispose(): void;
}

export function createSelectionPanel(plane: HTMLElement, handlers: SelectionPanelHandlers): SelectionPanel {
  const root = element('aside', 'on-window on-selection');
  root.hidden = true;
  root.style.width = `${SELECTION_PANEL_W}px`;
  const fill = element('div', 'on-selection__fill');

  const prev = button('on-browse', GLYPH.prev);
  const next = button('on-browse', GLYPH.next);
  const kickerText = element('span', '', '<span></span> <small></small>');
  const [kickerName, kickerCount] = [kickerText.children[0], kickerText.children[1]];
  if (kickerName === undefined || !(kickerCount instanceof HTMLElement)) throw new Error('selection: kicker');
  const kicker = element('p', 'on-kicker');
  kicker.append(prev, kickerText, next);
  prev.addEventListener('click', () => handlers.onBrowse(-1));
  next.addEventListener('click', () => handlers.onBrowse(1));
  kickerText.addEventListener('dblclick', () => handlers.onKickerDoubleClick());

  const title = element('h2', 'on-selection__title');
  const plainName = element('span', '');
  const renameButton = button('on-rename', `<span></span>${GLYPH.pen}`);
  const renameText = renameButton.firstElementChild;
  if (renameText === null) throw new Error('selection: rename');
  const field = element('input', 'on-rename-field');
  field.type = 'text';
  field.autocomplete = 'off';
  field.hidden = true;
  title.append(plainName, renameButton, field);
  const meta = element('div', 'on-selection__meta');

  const heading = element('div', 'on-selection__heading');
  heading.append(kicker, title, meta);
  // Gold, first in the row: a new player finds the ring here, so it must not read as one more chrome
  // control.
  const orders = button('on-medallion on-medallion--gold', GLYPH.orders);
  orders.addEventListener('click', (event) =>
    handlers.onOrders({ x: event.clientX, y: event.clientY, panelLeft: root.getBoundingClientRect().left }),
  );
  const close = button('on-medallion', GLYPH.close);
  close.addEventListener('click', () => handlers.onClose());
  const medallions = element('span', 'on-selection__medallions');
  medallions.append(orders, close);
  const head = element('header', 'on-window__head');
  head.append(heading, medallions);
  const body = element('div', 'on-selection__body');
  root.innerHTML = WINDOW_ORNAMENTS;
  root.prepend(fill);
  root.append(head, body);
  plane.append(root);

  let editing = false;
  let shownTitle = '';
  const endRename = (commit: boolean): void => {
    if (!editing) return;
    editing = false;
    const name = field.value.trim();
    setHidden(field, true);
    setHidden(renameButton, false);
    if (commit && name !== shownTitle) handlers.onRename(name);
  };
  renameButton.addEventListener('click', () => {
    editing = true;
    field.value = shownTitle;
    setHidden(renameButton, true);
    setHidden(field, false);
    field.focus();
    field.select();
  });
  field.addEventListener('keydown', (event) => {
    // The field keeps every key: Escape must not also clear the selection underneath.
    event.stopPropagation();
    if (event.key === 'Enter') endRename(true);
    else if (event.key === 'Escape') endRename(false);
  });
  field.addEventListener('blur', () => endRename(false));

  let holeFrame: HTMLElement | null = null;
  let hole: ClientRect | null = null;
  let dirty = true;
  const invalidate = (): void => {
    dirty = true;
  };
  window.addEventListener('resize', invalidate);
  // A fold opening, a late font or an icon shifting the content moves the bottom-anchored frame.
  const resizes = new ResizeObserver(invalidate);
  resizes.observe(root);
  let placed = '';
  /** Stand above the beam when it reaches under the panel, and stop under the summary bar. */
  const place = (): void => {
    const bottom = selectionBottomInset({ width: plane.clientWidth, height: plane.clientHeight });
    const key = `${bottom}`;
    if (key === placed) return;
    placed = key;
    root.style.bottom = `${bottom}px`;
    root.style.maxHeight = `calc(100% - ${TOP_BAR_HEIGHT + SELECTION_TOP_GAP_PX + bottom}px)`;
  };
  const measure = (): ClientRect | null => {
    place();
    if (holeFrame === null || root.hidden) return null;
    const frameBox = holeFrame.getBoundingClientRect();
    const fillBox = fill.getBoundingClientRect();
    // Client px per design px: the plane is scaled as a whole.
    const scale = fill.offsetWidth === 0 ? 1 : fillBox.width / fill.offsetWidth;
    const x = (frameBox.left - fillBox.left) / scale + holeFrame.clientLeft;
    const y = (frameBox.top - fillBox.top) / scale + holeFrame.clientTop;
    fill.style.setProperty('--hole-x', `${x}px`);
    fill.style.setProperty('--hole-y', `${y}px`);
    fill.style.setProperty('--hole-w', `${holeFrame.clientWidth}px`);
    fill.style.setProperty('--hole-h', `${holeFrame.clientHeight}px`);
    return {
      left: frameBox.left + holeFrame.clientLeft * scale,
      top: frameBox.top + holeFrame.clientTop * scale,
      width: holeFrame.clientWidth * scale,
      height: holeFrame.clientHeight * scale,
    };
  };

  return {
    element: root,
    body,
    show: () => {
      if (root.hidden) invalidate();
      root.classList.remove(WARM_CLASS);
      setHidden(root, false);
      place();
    },
    hide: () => {
      endRename(false);
      setHidden(root, true);
    },
    isOpen: () => !root.hidden,
    updateHead(model): void {
      write(kickerName, model.kicker);
      const browse = model.browse;
      setHidden(prev, browse === null);
      setHidden(next, browse === null);
      setHidden(kickerCount, browse === null);
      if (browse !== null) {
        write(kickerCount, `${browse.index} / ${browse.count}`);
        setTitle(prev, browse.prevTooltip);
        setTitle(next, browse.nextTooltip);
        setTitle(kickerText, browse.kickerTooltip);
      } else setTitle(kickerText, '');
      setAttribute(prev, 'aria-label', model.labels.prev);
      setAttribute(next, 'aria-label', model.labels.next);
      shownTitle = model.title;
      write(plainName, model.title);
      write(renameText, model.title);
      if (model.rename === null) endRename(false);
      setHidden(plainName, model.rename !== null);
      if (!editing) setHidden(renameButton, model.rename === null);
      if (model.rename !== null) {
        setTitle(renameButton, model.rename.tooltip);
        if (field.maxLength !== model.rename.maxLength) field.maxLength = model.rename.maxLength;
      }
      setHidden(meta, model.meta === null);
      write(meta, model.meta ?? '');
      setHidden(orders, model.orders === null);
      if (model.orders !== null) {
        setTitle(orders, model.orders.tooltip);
        setAttribute(orders, 'aria-label', model.orders.tooltip);
      }
      setAttribute(close, 'aria-label', model.labels.close);
      setTitle(close, model.labels.close);
      setAttribute(root, 'aria-label', model.title);
      invalidate();
    },
    setHole(frame): void {
      if (frame === holeFrame) return;
      holeFrame = frame;
      if (frame === null) {
        for (const name of ['--hole-x', '--hole-y', '--hole-w', '--hole-h']) fill.style.removeProperty(name);
      }
      invalidate();
    },
    invalidate,
    warm(): void {
      root.classList.add(WARM_CLASS);
      setHidden(root, false);
      place();
      invalidate();
      measure();
      // Two frames: the first commits the style, the second rasters it.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!root.classList.contains(WARM_CLASS)) return;
          root.classList.remove(WARM_CLASS);
          setHidden(root, true);
        }),
      );
    },
    holeClientRect(): ClientRect | null {
      if (root.hidden) return null;
      if (dirty) {
        hole = measure();
        dirty = false;
      }
      return hole;
    },
    claims(clientX, clientY): boolean {
      if (root.hidden) return false;
      const hit = document.elementFromPoint(clientX, clientY);
      return hit !== null && root.contains(hit);
    },
    renaming: () => editing,
    dispose(): void {
      window.removeEventListener('resize', invalidate);
      resizes.disconnect();
      root.remove();
    },
  };
}
