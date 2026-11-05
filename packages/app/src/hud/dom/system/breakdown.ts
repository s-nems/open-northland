import { type GoodIconPainter, goodIconMarkup } from '../good-art.js';

/** Design px a breakdown keeps from the screen's side edges. */
const TIP_EDGE_MARGIN_PX = 6;

/** One label-and-figure row of a bar breakdown; the figure is the caller's to write. */
export function tipRow(label: string, className = ''): { row: HTMLElement; figure: HTMLElement } {
  const row = document.createElement('p');
  row.className = `on-tip__row ${className}`.trim();
  const name = document.createElement('span');
  name.textContent = label;
  const figure = document.createElement('b');
  row.append(name, figure);
  return { row, figure };
}

/** A good's icon on a breakdown row, a little taller than the row's type so the art stays legible. */
const TIP_GOOD_ICON_PX = 18;

/** A row naming a good by its icon and label. */
export function goodTipRow(
  label: string,
  goodId: string,
  paintGood: GoodIconPainter,
): { row: HTMLElement; figure: HTMLElement } {
  const made = tipRow(label, 'on-tip__row--good');
  const name = made.row.firstElementChild;
  if (name instanceof HTMLElement) {
    name.insertAdjacentHTML('afterbegin', goodIconMarkup(TIP_GOOD_ICON_PX));
    const frame = name.querySelector('.on-good__frame');
    if (frame instanceof HTMLElement) paintGood(frame, goodId, TIP_GOOD_ICON_PX);
  }
  return made;
}

/** A breakdown hangs under its counter, and on a narrow screen a wide one would run past the edge.
 *  Measured in screen px and converted back through the plane's scale, so the shift is design px. */
export function keepTipOnScreen(tip: HTMLElement): void {
  tip.style.transform = '';
  const rect = tip.getBoundingClientRect();
  if (rect.width === 0) return;
  const scale = rect.width / tip.offsetWidth;
  const margin = TIP_EDGE_MARGIN_PX * scale;
  const screenWidth = document.documentElement.clientWidth;
  const shift = Math.min(0, screenWidth - margin - rect.right) + Math.max(0, margin - rect.left);
  if (shift !== 0) tip.style.transform = `translateX(${String(shift / scale)}px)`;
}
