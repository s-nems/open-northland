import { TIP_ATTRIBUTE } from './dom.js';

/** The cursor-following text chip a tip layer shows its tooltips in. */
export interface TipChip {
  show(clientX: number, clientY: number, text: string): void;
  hide(): void;
}

/** Ms the cursor rests on a control before its tip shows: under the browser's own second, so a quick
 *  look at a button answers, over a flick across the panel, which must show nothing. */
export const TIP_DELAY_MS = 500;

/** What a frame does with a shown tip: keep it, show the control's new text, or hide it. */
export type TipRefresh = 'keep' | 'show' | 'hide';

/** `present` is false once the control left the surface or is no longer drawn. */
export function tipRefresh(shownText: string, text: string, present: boolean): TipRefresh {
  if (!present || text === '') return 'hide';
  return text === shownText ? 'keep' : 'show';
}

/**
 * One tooltip behaviour for a surface: the tip of the control under the cursor (`data-tip`, set with
 * `setTip`) shows in `chip` after {@link TIP_DELAY_MS}, follows the cursor while it stays on the
 * control, and goes on leave or on a press. Keyboard focus shows the focused control's tip at once,
 * at the control, until focus leaves it. The browser's own `title` tooltip is not used on the
 * surface: its delay cannot be set.
 */
export interface TipLayer {
  /** Once a frame after the surface painted: a shown tip takes its control's current text, and goes
   *  when the text, the control or its visibility went. A text changing on a tick sends no event. */
  refresh(): void;
  /** The surface is going away or hiding: no pending tip fires. */
  hide(): void;
  dispose(): void;
}

export function attachTipLayer(surface: HTMLElement, chip: TipChip, delayMs = TIP_DELAY_MS): TipLayer {
  let control: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The text on the chip; empty while it shows nothing. */
  let shownText = '';
  let at = { x: 0, y: 0 };
  const clearTimer = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const hide = (): void => {
    clearTimer();
    control = null;
    if (shownText !== '') chip.hide();
    shownText = '';
  };
  const present = (node: HTMLElement): boolean => surface.contains(node) && node.checkVisibility();
  /** Show the control's current text at `at`, or hide when there is none to show. */
  const show = (): void => {
    const text = control?.getAttribute(TIP_ATTRIBUTE) ?? '';
    if (control === null || tipRefresh(shownText, text, present(control)) === 'hide') {
      hide();
      return;
    }
    chip.show(at.x, at.y, text);
    shownText = text;
  };
  const controlAt = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    const found = target.closest(`[${TIP_ATTRIBUTE}]`);
    return found instanceof HTMLElement && surface.contains(found) ? found : null;
  };
  const onOver = (event: MouseEvent): void => {
    const next = controlAt(event.target);
    at = { x: event.clientX, y: event.clientY };
    if (next === control) return;
    hide();
    control = next;
    if (control !== null) timer = setTimeout(show, delayMs);
  };
  const onMove = (event: MouseEvent): void => {
    at = { x: event.clientX, y: event.clientY };
    if (shownText !== '') show();
  };
  const onOut = (event: MouseEvent): void => {
    if (control === null) return;
    const to = event.relatedTarget;
    if (to instanceof Node && control.contains(to)) return;
    hide();
  };
  // Only a keyboard focus: a click focuses its button too, and the press hides the tip.
  const onFocusIn = (event: FocusEvent): void => {
    const next = controlAt(event.target);
    if (next === null || !(event.target instanceof Element) || !event.target.matches(':focus-visible'))
      return;
    hide();
    control = next;
    // As if the cursor rested on the control's centre.
    const box = next.getBoundingClientRect();
    at = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    show();
  };
  const onFocusOut = (event: FocusEvent): void => {
    if (control === null || !(event.target instanceof Node) || !control.contains(event.target)) return;
    const to = event.relatedTarget;
    if (to instanceof Node && control.contains(to)) return;
    hide();
  };
  surface.addEventListener('mouseover', onOver);
  surface.addEventListener('mousemove', onMove);
  surface.addEventListener('mouseout', onOut);
  surface.addEventListener('mousedown', hide);
  surface.addEventListener('focusin', onFocusIn);
  surface.addEventListener('focusout', onFocusOut);
  return {
    refresh(): void {
      if (control === null || shownText === '') return;
      const text = control.getAttribute(TIP_ATTRIBUTE) ?? '';
      switch (tipRefresh(shownText, text, present(control))) {
        case 'keep':
          return;
        case 'hide':
          hide();
          return;
        case 'show':
          chip.show(at.x, at.y, text);
          shownText = text;
          return;
      }
    },
    hide,
    dispose(): void {
      hide();
      surface.removeEventListener('mouseover', onOver);
      surface.removeEventListener('mousemove', onMove);
      surface.removeEventListener('mouseout', onOut);
      surface.removeEventListener('mousedown', hide);
      surface.removeEventListener('focusin', onFocusIn);
      surface.removeEventListener('focusout', onFocusOut);
    },
  };
}
