import { type GoodIconPainter, goodIconMarkup } from '../good-art.js';
import { GLYPH } from '../icons.js';
import { button, element, setAttribute, setClass, setHidden, setTitle } from './dom.js';

/** A worn item under a quarter of its life left shows its wear bar red. */
export const SOCKET_WORN_BELOW_PCT = 25;
/** Design px of the good icon in a 34 px socket (foundation.css). */
const SOCKET_ICON_PX = 26;

export type SocketModel =
  | {
      readonly kind: 'empty';
      /** The line glyph of what goes here; null for a bag cell, which takes anything. */
      readonly ghost: string | null;
      readonly label: string;
      readonly tooltip: string;
    }
  | {
      readonly kind: 'item';
      readonly goodId: string | undefined;
      /** The life left in percent, null for a good that does not wear. */
      readonly wearPct: number | null;
      readonly label: string;
      readonly tooltip: string;
      /** The × that takes the item off, null when it cannot come off. */
      readonly removeLabel: string | null;
    };

export interface SocketOptions {
  /** A hero's fixed arms: a flat, frameless, inert socket. */
  readonly fixed?: boolean;
  /** A bag cell: a dashed rim while empty. */
  readonly bag?: boolean;
  readonly icons?: GoodIconPainter;
  readonly onPress?: () => void;
  readonly onRemove?: () => void;
}

/** One 34 px equipment socket: a ghost glyph when empty, else the good over its wear bar, with a small
 *  × at the corner on hover or focus. */
export interface Socket {
  readonly element: HTMLElement;
  update(model: SocketModel): void;
}

export function createSocket(options: SocketOptions): Socket {
  const fixed = options.fixed === true;
  const root = element('span', 'on-socket-group');
  const face = fixed ? element('span', 'on-socket on-socket--fixed') : button('on-socket');
  if (options.bag === true) face.classList.add('on-socket--bag');
  root.append(face);
  const off = fixed ? null : button('on-socket__off', GLYPH.close);
  if (off !== null) {
    root.append(off);
    off.addEventListener('click', () => options.onRemove?.());
  }
  if (!fixed) face.addEventListener('click', () => options.onPress?.());

  let shown = '';
  let wear: HTMLElement | null = null;
  const paint = (model: SocketModel): void => {
    const key = model.kind === 'empty' ? `empty:${model.ghost ?? ''}` : `item:${model.goodId ?? ''}`;
    if (key === shown) return;
    shown = key;
    if (model.kind === 'empty') {
      face.innerHTML = model.ghost ?? '';
      wear = null;
      return;
    }
    face.innerHTML = `${goodIconMarkup(SOCKET_ICON_PX)}<i class="on-socket__wear"></i>`;
    wear = face.querySelector('.on-socket__wear');
    const frame = face.querySelector('.on-good__frame');
    if (model.goodId !== undefined && frame instanceof HTMLElement) {
      options.icons?.(frame, model.goodId, SOCKET_ICON_PX);
    }
  };

  return {
    element: root,
    update(model): void {
      paint(model);
      setClass(face, 'on-socket--empty', model.kind === 'empty');
      setTitle(face, model.tooltip);
      setAttribute(face, 'aria-label', model.label);
      const wearPct = model.kind === 'item' ? model.wearPct : null;
      if (wear !== null) {
        setHidden(wear, wearPct === null);
        const width = `${wearPct ?? 0}%`;
        if (wear.style.getPropertyValue('--value') !== width) wear.style.setProperty('--value', width);
      }
      setClass(face, 'on-socket--worn', wearPct !== null && wearPct < SOCKET_WORN_BELOW_PCT);
      if (off !== null) {
        const removable = model.kind === 'item' && model.removeLabel !== null;
        setHidden(off, !removable);
        if (model.kind === 'item' && model.removeLabel !== null) {
          setAttribute(off, 'aria-label', model.removeLabel);
          setTitle(off, model.removeLabel);
        }
      }
    },
  };
}
