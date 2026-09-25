import { type GoodIconPainter, goodIconMarkup } from '../good-art.js';
import { button, isDisabled, removeAttribute, setAttribute, setClass, setDisabled, setTitle } from './dom.js';

/**
 * A round icon chip: a ledger row's assign or remove (20 px), a section title's add (22 px), a product's
 * good (30 px) or a trade stop's import toggle (26 px). The size is the kind's; the face is a line glyph
 * or a good's icon.
 */
export type RoundButtonKind = 'ledger' | 'title' | 'good' | 'toggle';

const KIND_CLASS: Readonly<Record<RoundButtonKind, string>> = {
  ledger: 'on-round',
  title: 'on-round on-round--title',
  good: 'on-round on-round--good',
  toggle: 'on-round on-round--toggle',
};

/** Design px of a good icon on each kind's face (foundation.css sizes the chips around them). */
const GOOD_ICON_PX: Readonly<Record<RoundButtonKind, number>> = {
  ledger: 14,
  title: 16,
  good: 20,
  toggle: 20,
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
  /** A toggle chip's state; absent on a plain button. */
  readonly pressed?: boolean;
}

export interface RoundButton {
  readonly element: HTMLButtonElement;
  /** Null keeps the slot's width with nothing in it, so a row's other chip does not move. */
  update(model: RoundButtonModel | null): void;
}

function faceKey(face: RoundButtonFace): string {
  return 'glyph' in face ? face.glyph : `good:${face.goodId ?? ''}`;
}

export function createRoundButton(
  kind: RoundButtonKind,
  onPress: (event: MouseEvent) => void,
  icons?: GoodIconPainter,
): RoundButton {
  const element = button(KIND_CLASS[kind]);
  let face = '';
  element.addEventListener('click', (event) => {
    if (isDisabled(element) || element.classList.contains('on-round--blank')) return;
    onPress(event);
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
      setTitle(element, model.tooltip);
      setDisabled(element, model.enabled === false);
      if (model.pressed !== undefined) setAttribute(element, 'aria-pressed', String(model.pressed));
    },
  };
}
