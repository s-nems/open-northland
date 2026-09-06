import { Application, Container, type FillInstruction, Graphics, type StrokeInstruction } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { buildToolPanelLayout } from '../src/hud/tool-panel/layout.js';
import { createStripSurface } from '../src/hud/tool-panel/strip-surface.js';

/** The art-less tool strip over an Application that was never `init`ed: it has no renderer, so any bake
 *  or resolution read below would throw rather than return. */
function flatStrip(uiscale: number) {
  const container = new Container();
  const layout = buildToolPanelLayout(uiscale);
  const surface = createStripSurface({ app: new Application(), container, layout, art: null });
  const drawn = container.children[0];
  if (!(drawn instanceof Graphics)) throw new Error('the flat strip drew nothing');
  return { surface, layout, drawn };
}

const FALLBACK_STRIP = 0x1c1810;
const FALLBACK_BUTTON = 0x4a3f28;
const FALLBACK_BUTTON_BORDER = 0x8a744a;

type PaintedShape = FillInstruction | StrokeInstruction;

/** The strip's fills and strokes in draw order: the backdrop, then a block and border per button. */
function paintedShapes(drawn: Graphics, action: PaintedShape['action']): PaintedShape[] {
  return drawn.context.instructions.flatMap((i) =>
    i.action === action && 'path' in i.data ? [i as PaintedShape] : [],
  );
}

function shapeAt(shapes: readonly PaintedShape[], index: number): PaintedShape {
  const shape = shapes[index];
  if (shape === undefined) throw new Error(`the strip drew no shape at ${index}`);
  return shape;
}

/** The `[x, y, w, h]` of the rect a shape drew; Pixi may prefix the path with a `moveTo`. */
function rectOf(shape: PaintedShape): number[] {
  const rect = shape.data.path.instructions.find((p) => p.action === 'rect');
  if (rect === undefined) throw new Error('the shape drew no rect');
  return rect.data.slice(0, 4).map(Number);
}

describe('tool strip without decoded GUI art', () => {
  it('insets a button block inside its placed rect on every side', () => {
    const { layout, drawn } = flatStrip(1);
    const fills = paintedShapes(drawn, 'fill');
    const first = layout.buttons[0]?.placed;
    if (first === undefined) throw new Error('the layout placed no buttons');

    expect(rectOf(shapeAt(fills, 0))).toEqual([
      layout.strip.x,
      layout.strip.y,
      layout.strip.w,
      layout.strip.h,
    ]);
    // The inset is screen px on every side, so it does not scale with the rect it sits in.
    expect(rectOf(shapeAt(fills, 1))).toEqual([first.x + 2, first.y + 2, first.w - 4, first.h - 4]);
    expect(rectOf(shapeAt(paintedShapes(drawn, 'stroke'), 0))).toEqual(rectOf(shapeAt(fills, 1)));
  });

  it('paints the backdrop, blocks and borders in the fallback tones', () => {
    const { drawn } = flatStrip(1);
    const fills = paintedShapes(drawn, 'fill');

    expect(shapeAt(fills, 0).data.style.color).toBe(FALLBACK_STRIP);
    expect(shapeAt(fills, 1).data.style.color).toBe(FALLBACK_BUTTON);
    expect(shapeAt(paintedShapes(drawn, 'stroke'), 0).data.style.color).toBe(FALLBACK_BUTTON_BORDER);
  });

  it('draws one bordered block per tool button over a single strip backdrop', () => {
    const { layout, drawn } = flatStrip(1);
    const actions = drawn.context.instructions.map((i) => i.action);

    expect(actions.filter((a) => a === 'stroke')).toHaveLength(layout.buttons.length);
    // One fill per button block plus the strip backdrop and the message-priority plaque.
    expect(actions.filter((a) => a === 'fill')).toHaveLength(layout.buttons.length + 2);
  });

  it('stays inside the strip and plaque rects the panel claims, at a fractional scale too', () => {
    const { layout, drawn } = flatStrip(1.75);
    const bounds = drawn.getLocalBounds();

    expect(bounds.minX).toBe(layout.strip.x);
    expect(bounds.minY).toBe(layout.frame.y);
    expect(bounds.maxX).toBeCloseTo(layout.frame.x + layout.frame.w);
    expect(bounds.maxY).toBeCloseTo(layout.strip.y + layout.strip.h);
  });

  it('offers no bake, so the speed button falls back to its text glyph and no frame re-bakes', () => {
    const { surface } = flatStrip(1);

    expect(surface.current()).toBeNull();
    expect(() => surface.reframe('speed', 0x34)).not.toThrow();
    expect(surface.syncResolution()).toBe(false);
  });
});
