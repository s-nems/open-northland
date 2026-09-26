import { type GoodIconPainter, goodIconMarkup } from '../good-art.js';
import {
  button,
  isDisabled,
  onPress,
  removeAttribute,
  setAttribute,
  setClass,
  setDisabled,
  setTip,
} from './dom.js';

/**
 * A round icon chip: a ledger row's assign or remove (18 px) or a product's good (22 px). The size is
 * the kind's; the face is a line glyph or a good's icon.
 */
export type RoundButtonKind = 'ledger' | 'good';

const KIND_CLASS: Readonly<Record<RoundButtonKind, string>> = {
  ledger: 'on-round',
  good: 'on-round on-round--good',
};

/** Design px of a good icon on each kind's face (foundation.css sizes the chips around them). */
const GOOD_ICON_PX: Readonly<Record<RoundButtonKind, number>> = {
  ledger: 12,
  good: 16,
};

export type RoundButtonFace = { readonly glyph: string } | { readonly goodId: string | undefined };

export interface RoundButtonModel {
  readonly face: RoundButtonFace;
  /** The accessible name. */
  readonly label: string;
  /** What the press does, or why it is refused. */
  readonly tooltip: string;
  /** False fades the chip and ignores the press; the tooltip then carries the reason. */
  readonly enabled?: boolean;
}

export interface RoundButton {
  readonly element: HTMLButtonElement;
  /** Null collapses the chip, so a row's value sits against whatever chips it has. */
  update(model: RoundButtonModel | null): void;
}

function faceKey(face: RoundButtonFace): string {
  return 'glyph' in face ? face.glyph : `good:${face.goodId ?? ''}`;
}

export function createRoundButton(
  kind: RoundButtonKind,
  press: (event: MouseEvent) => void,
  icons?: GoodIconPainter,
): RoundButton {
  const element = button(KIND_CLASS[kind]);
  let face = '';
  onPress(element, (event) => {
    if (isDisabled(element) || element.classList.contains('on-round--blank')) return;
    press(event);
  });
  const paintFace = (next: RoundButtonFace): void => {
    const key = faceKey(next);
    if (key === face) return;
    face = key;
    if ('glyph' in next) {
      element.innerHTML = next.glyph;
      return;
    }
    const px = GOOD_ICON_PX[kind];
    element.innerHTML = goodIconMarkup(px);
    const frame = element.querySelector('.on-good__frame');
    if (next.goodId !== undefined && frame instanceof HTMLElement) icons?.(frame, next.goodId, px);
  };
  return {
    element,
    update(model): void {
      setClass(element, 'on-round--blank', model === null);
      if (model === null) {
        setAttribute(element, 'aria-hidden', 'true');
        setAttribute(element, 'tabindex', '-1');
        return;
      }
      removeAttribute(element, 'aria-hidden');
      removeAttribute(element, 'tabindex');
      paintFace(model.face);
      setAttribute(element, 'aria-label', model.label);
      setTip(element, model.tooltip);
      setDisabled(element, model.enabled === false);
    },
  };
}
