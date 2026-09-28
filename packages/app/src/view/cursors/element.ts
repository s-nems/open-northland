import { type CursorState, cursorVariable } from './model.js';

type CanvasCursorSource = 'hover' | 'pick' | 'placement';
const SOURCES = {
  hover: { attribute: 'data-cursor-hover', property: '--world-cursor-hover' },
  pick: { attribute: 'data-cursor-pick', property: '--world-cursor-pick' },
  placement: { attribute: 'data-cursor-placement', property: '--world-cursor-placement' },
} as const;

/** CSS gives placement precedence over a pending order, then over a hovered object. */
export function setCanvasCursor(
  canvas: HTMLCanvasElement,
  source: CanvasCursorSource,
  state: CursorState | null,
): void {
  const { attribute, property } = SOURCES[source];
  if (canvas.getAttribute(attribute) === state) return;
  if (state === null) {
    canvas.removeAttribute(attribute);
    canvas.style.removeProperty(property);
  } else {
    canvas.setAttribute(attribute, state);
    canvas.style.setProperty(property, cursorVariable(state));
  }
}

export function clearCanvasCursors(canvas: HTMLCanvasElement): void {
  for (const source of ['hover', 'pick', 'placement'] as const) setCanvasCursor(canvas, source, null);
}
