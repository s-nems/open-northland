import { TIP_ATTRIBUTE } from './dom.js';

/** The cursor-following text chip a tip layer shows its tooltips in. */
export interface TipChip {
  show(clientX: number, clientY: number, text: string): void;
  hide(): void;
}

/** Ms the cursor rests on a control before its tip shows: under the browser's own second, so a quick
 *  look at a button answers, over a flick across the panel, which must show nothing. */
export const TIP_DELAY_MS = 500;

/**
 * One tooltip behaviour for a surface: the tip of the control under the cursor (`data-tip`, set with
 * `setTip`) shows in `chip` after {@link TIP_DELAY_MS}, follows the cursor while it stays on the
 * control, refreshes when the text changes under it, and goes on leave or on a press. The browser's
 * own `title` tooltip is not used on the surface: its delay cannot be set.
 */
export interface TipLayer {
  /** The surface is going away or hiding: no pending tip fires. */
  hide(): void;
  dispose(): void;
}

export function attachTipLayer(surface: HTMLElement, chip: TipChip, delayMs = TIP_DELAY_MS): TipLayer {
  let control: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let shown = false;
  let at = { x: 0, y: 0 };
  const clearTimer = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const hide = (): void => {
    clearTimer();
    control = null;
    if (shown) chip.hide();
    shown = false;
  };
  const show = (): void => {
    const text = control?.getAttribute(TIP_ATTRIBUTE) ?? '';
    if (control === null || text === '') {
      hide();
      return;
    }
    chip.show(at.x, at.y, text);
    shown = true;
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
    if (shown) show();
  };
  const onOut = (event: MouseEvent): void => {
    if (control === null) return;
    const to = event.relatedTarget;
    if (to instanceof Node && control.contains(to)) return;
    hide();
  };
  surface.addEventListener('mouseover', onOver);
  surface.addEventListener('mousemove', onMove);
  surface.addEventListener('mouseout', onOut);
  surface.addEventListener('mousedown', hide);
  return {
    hide,
    dispose(): void {
      hide();
      surface.removeEventListener('mouseover', onOver);
      surface.removeEventListener('mousemove', onMove);
      surface.removeEventListener('mouseout', onOut);
      surface.removeEventListener('mousedown', hide);
    },
  };
}
