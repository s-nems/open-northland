import { contains, type Rect } from '../../geometry.js';

/**
 * The note strip's design-space geometry (pre-scale): notes stand on the screen's top edge right of
 * the priority plaque and pack tighter as they multiply, never past the strip's span (approximation:
 * macOS build symbols).
 */
export const NOTE_STRIP_ORIGIN_X = 144;
export const NOTE_W = 54;
export const NOTE_H = 69;
export const NOTE_STRIP_SPAN = 400;

/** The step between consecutive notes: one note wide until the span would overflow. */
export function noteSpacing(count: number): number {
  return count <= 0 ? NOTE_W : Math.min(NOTE_W, NOTE_STRIP_SPAN / count);
}

/** One screen rect per note, in strip order. */
export function layoutMessageNotes(count: number, scale: number): Rect[] {
  const step = noteSpacing(count);
  const rects: Rect[] = [];
  for (let i = 0; i < count; i++) {
    rects.push({ x: (NOTE_STRIP_ORIGIN_X + i * step) * scale, y: 0, w: NOTE_W * scale, h: NOTE_H * scale });
  }
  return rects;
}

/** The index of the note under a screen point; a later note draws over its overlapped predecessor, so
 *  it wins. */
export function hitTestNotes(notes: readonly { readonly rect: Rect }[], x: number, y: number): number | null {
  for (let i = notes.length - 1; i >= 0; i--) {
    const note = notes[i];
    if (note !== undefined && contains(note.rect, x, y)) return i;
  }
  return null;
}
