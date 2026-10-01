import { EventSystem } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { leaveCursorToCss } from '../src/gpu/pixi-app.js';

/** Pixi's own `setCursor` over a stand-in canvas, with the styles a fresh event system starts with. */
function eventSystemOnCanvas(): {
  events: { cursorStyles: Record<string, unknown> };
  style: { cursor?: string };
  setCursor: (mode: string) => void;
} {
  const style: { cursor?: string } = {};
  const events = {
    cursorStyles: { default: 'inherit', pointer: 'pointer' } as Record<string, unknown>,
    domElement: { style },
    _currentCursor: null as string | null,
  };
  return { events, style, setCursor: (mode) => EventSystem.prototype.setCursor.call(events, mode) };
}

describe('leaveCursorToCss', () => {
  it("writes an inline cursor by default, which outranks the stylesheet's world cursors", () => {
    const { style, setCursor } = eventSystemOnCanvas();
    setCursor('default');
    expect(style.cursor).toBe('inherit');
  });

  it('leaves the canvas cursor to CSS for every mode Pixi knows', () => {
    const { events, style, setCursor } = eventSystemOnCanvas();
    leaveCursorToCss(events);
    for (const mode of ['default', 'pointer']) setCursor(mode);
    expect(style.cursor).toBeUndefined();
  });
});
