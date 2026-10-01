import type { GoodIconPainter } from '../good-art.js';
import { button, element, setClass, setHidden, setTip, write } from './dom.js';
import { createRoundButton, type RoundButton, type RoundButtonModel } from './round-button.js';

/** One piece of a ledger value: plain text, or a link the owner answers. `missing` reads amber (an
 *  empty seat the player can fill), `muted` grey, `bonus` green and small. */
export interface LedgerSegment {
  readonly text: string;
  readonly link?: boolean;
  readonly tooltip?: string;
  readonly tone?: 'missing' | 'muted' | 'bonus';
}

export interface LedgerModel {
  readonly label: string;
  /** A glyph before the label (a lock on an unlock row). */
  readonly labelGlyph?: string;
  /** A muted aside after the label. */
  readonly labelNote?: string;
  readonly tooltip?: string;
  /** Joined by " · ", except a bonus, which follows its figure. */
  readonly value: readonly LedgerSegment[];
  /** Up to the row's button count; a null keeps its slot blank. */
  readonly buttons?: readonly (RoundButtonModel | null)[];
}

export interface LedgerOptions {
  /** Round buttons after the value (centre, assign, remove), 0 to 3. */
  readonly buttons?: number;
  readonly onLink?: (index: number, event: MouseEvent) => void;
  /** The cursor entered (an event) or left (null) the link at `index`. */
  readonly onLinkHover?: (index: number, event: MouseEvent | null) => void;
  readonly onButton?: (index: number, event: MouseEvent) => void;
  readonly icons?: GoodIconPainter;
}

/** A ledger row: the label over a dotted leader, the value (text or links), trailing round buttons. */
export interface Ledger {
  readonly element: HTMLElement;
  update(model: LedgerModel): void;
}

const SEPARATOR = ' · ';

function segmentShape(segments: readonly LedgerSegment[]): string {
  return segments.map((segment) => `${segment.link === true ? 'a' : 't'}${segment.tone ?? ''}`).join(',');
}

export function createLedger(options: LedgerOptions = {}): Ledger {
  const count = options.buttons ?? 0;
  const root = element('div', count > 0 ? 'on-ledger on-ledger--ctl' : 'on-ledger');
  const label = element('span', '', '<i class="on-ledger__glyph"></i><span></span><small></small>');
  const [glyph, text, note] = [label.children[0], label.children[1], label.children[2]];
  if (!(glyph instanceof HTMLElement) || text === undefined || !(note instanceof HTMLElement)) {
    throw new Error('ledger: label template');
  }
  const value = element('b', 'on-ledger__value');
  root.append(label, value);
  const buttons: RoundButton[] = [];
  if (count > 0) {
    const group = element('span', 'on-ledger__btns');
    for (let i = 0; i < count; i++) {
      const chip = createRoundButton('ledger', (event) => options.onButton?.(i, event), options.icons);
      buttons.push(chip);
      group.append(chip.element);
    }
    root.append(group);
  }

  let shape = '';
  let pieces: HTMLElement[] = [];
  const build = (segments: readonly LedgerSegment[]): void => {
    pieces = segments.map((segment, index) => {
      if (segment.link !== true) return element(segment.tone === 'bonus' ? 'small' : 'span', '');
      const link = button('on-ledger__link');
      link.addEventListener('click', (event) => options.onLink?.(index, event));
      if (options.onLinkHover !== undefined) {
        const hover = options.onLinkHover;
        link.addEventListener('mouseenter', (event) => hover(index, event));
        link.addEventListener('mousemove', (event) => hover(index, event));
        link.addEventListener('mouseleave', () => hover(index, null));
      }
      return link;
    });
    const nodes: (Node | string)[] = [];
    pieces.forEach((piece, index) => {
      const bonus = segments[index]?.tone === 'bonus';
      if (index > 0) nodes.push(bonus ? ' ' : SEPARATOR);
      nodes.push(piece);
    });
    value.replaceChildren(...nodes);
  };

  return {
    element: root,
    update(model): void {
      setHidden(glyph, model.labelGlyph === undefined);
      if (model.labelGlyph !== undefined && glyph.innerHTML !== model.labelGlyph)
        glyph.innerHTML = model.labelGlyph;
      write(text, model.label);
      write(note, model.labelNote ?? '');
      setHidden(note, model.labelNote === undefined);
      setTip(root, model.tooltip ?? '');
      const nextShape = segmentShape(model.value);
      if (nextShape !== shape) {
        shape = nextShape;
        build(model.value);
      }
      model.value.forEach((segment, index) => {
        const piece = pieces[index];
        if (piece === undefined) return;
        write(piece, segment.text);
        setTip(piece, segment.tooltip ?? '');
        setClass(piece, 'on-ledger--missing', segment.tone === 'missing');
        setClass(piece, 'on-ledger--muted', segment.tone === 'muted');
      });
      for (const [index, chip] of buttons.entries()) chip.update(model.buttons?.[index] ?? null);
    },
  };
}
