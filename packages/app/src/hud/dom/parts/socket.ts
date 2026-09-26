import { type GoodIconPainter, goodIconMarkup } from '../good-art.js';
import { GLYPH } from '../icons.js';
import { button, element, setAttribute, setClass, setDisabled, setHidden, setTip } from './dom.js';

/** A worn item under half its life shows its wear fill amber, under a quarter red. */
export const SOCKET_WEARING_BELOW_PCT = 50;
export const SOCKET_WORN_BELOW_PCT = 25;

export type SocketWearTone = 'fresh' | 'wearing' | 'worn';

export function socketWearTone(wearPct: number): SocketWearTone {
  if (wearPct < SOCKET_WORN_BELOW_PCT) return 'worn';
  return wearPct < SOCKET_WEARING_BELOW_PCT ? 'wearing' : 'fresh';
}
/** Design px of the good icon in a 30 px socket (foundation.css). */
const SOCKET_ICON_PX = 23;

export type SocketModel =
  | {
      readonly kind: 'empty';
      /** The line glyph of what goes here; null for a bag cell, which takes anything. */
      readonly ghost: string | null;
      /** A slot this person never fills (a woman's, a child's): faded, a press does nothing. */
      readonly inert: boolean;
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

/** One 30 px equipment socket: a ghost glyph when empty, else the good over its wear fill (the well
 *  filled from the bottom to the life left), with a small × at the corner on hover or focus. */
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
    face.innerHTML = `<i class="on-socket__wear"></i>${goodIconMarkup(SOCKET_ICON_PX)}`;
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
      if (!fixed) setDisabled(face, model.kind === 'empty' && model.inert);
      setTip(face, model.tooltip);
      setAttribute(face, 'aria-label', model.label);
      const wearPct = model.kind === 'item' ? model.wearPct : null;
      if (wear !== null) {
        setHidden(wear, wearPct === null);
        const fill = `${wearPct ?? 0}%`;
        if (wear.style.getPropertyValue('--value') !== fill) wear.style.setProperty('--value', fill);
      }
      const tone = wearPct === null ? 'fresh' : socketWearTone(wearPct);
      setClass(face, 'on-socket--wearing', tone === 'wearing');
      setClass(face, 'on-socket--worn', tone === 'worn');
      if (off !== null) {
        const removable = model.kind === 'item' && model.removeLabel !== null;
        setHidden(off, !removable);
        if (model.kind === 'item' && model.removeLabel !== null) {
          setAttribute(off, 'aria-label', model.removeLabel);
          setTip(off, model.removeLabel);
        }
      }
    },
  };
}
