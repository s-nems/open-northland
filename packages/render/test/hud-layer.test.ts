import { Text } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { HudPlacement } from '../src/data/hud.js';
import { DEFAULT_HUD_STYLE, HudLayer, type HudStyle } from '../src/gpu/overlays/hud-layer.js';

/**
 * The retained HudLayer's change-detection state machine is agent-checkable headless (Pixi
 * `Container`/`Graphics`/`Text` construct without a GL context — the same stance as
 * selection-layer.test.ts); only the rasterized glyphs stay human-gated. These pin the pool
 * invariants a later edit would break with a human-visible-only symptom: rows are pooled (hidden,
 * not destroyed), text updates in place, and a row hidden ACROSS a style change restyles on reuse.
 */

/** A placed HUD panel with the given row strings (positions don't matter for these tests). */
function placement(...texts: string[]): HudPlacement {
  return {
    panelX: 8,
    panelY: 8,
    width: 200,
    height: 24 + 16 * texts.length,
    rows: texts.map((text, i) => ({ x: 16, y: 16 + 16 * i, text })),
  };
}

/** The layer's pooled Text children, in pool order. */
function rowTexts(layer: HudLayer): Text[] {
  return layer.container.children.filter((c): c is Text => c instanceof Text);
}

describe('HudLayer — retained rows + change detection', () => {
  it('toggles visibility for an absent frame and back, keeping the pooled rows', () => {
    const layer = new HudLayer();
    layer.draw({ placement: placement('a', 'b') });
    expect(layer.container.visible).toBe(true);
    expect(rowTexts(layer)).toHaveLength(2);
    layer.draw(undefined);
    expect(layer.container.visible).toBe(false);
    expect(rowTexts(layer)).toHaveLength(2); // hidden, not torn down
    layer.draw({ placement: placement('a', 'b') });
    expect(layer.container.visible).toBe(true);
  });

  it('reuses pooled rows in place: shrink hides the surplus, regrow re-shows it', () => {
    const layer = new HudLayer();
    layer.draw({ placement: placement('a', 'b', 'c') });
    const rows = rowTexts(layer);
    expect(rows).toHaveLength(3);
    layer.draw({ placement: placement('a', 'b') });
    expect(rowTexts(layer)).toHaveLength(3); // pooled — same objects, no destroy/create churn
    expect(rows[2]?.visible).toBe(false);
    layer.draw({ placement: placement('a', 'b', 'd') });
    expect(rowTexts(layer)).toHaveLength(3);
    expect(rows[2]?.visible).toBe(true);
    expect(rows[2]?.text).toBe('d'); // the reused row shows the new string
  });

  it('updates a row string in place when it changes', () => {
    const layer = new HudLayer();
    layer.draw({ placement: placement('tick 1') });
    const row = rowTexts(layer)[0];
    layer.draw({ placement: placement('tick 2') });
    expect(rowTexts(layer)[0]).toBe(row); // same pooled Text object
    expect(row?.text).toBe('tick 2');
  });

  it('restyles a row that sat HIDDEN across a style change when it is reused', () => {
    const layer = new HudLayer();
    const bigText: HudStyle = { ...DEFAULT_HUD_STYLE, fontSize: 20 };
    layer.draw({ placement: placement('a', 'b') }); // both rows at the default 12px
    const rows = rowTexts(layer);
    layer.draw({ placement: placement('a'), style: bigText }); // row 1 hidden DURING the style change
    layer.draw({ placement: placement('a', 'b'), style: bigText }); // row 1 reused; style unchanged this frame
    expect(rows[0]?.style.fontSize).toBe(20);
    expect(rows[1]?.style.fontSize).toBe(20); // the revived row must not keep the stale 12px
  });

  it('detects an in-place mutation of a reused style object (snapshot by value)', () => {
    const layer = new HudLayer();
    const style: { -readonly [K in keyof HudStyle]: HudStyle[K] } = { ...DEFAULT_HUD_STYLE };
    layer.draw({ placement: placement('a'), style });
    style.fontSize = 20; // callers may legally mutate one options object between frames
    layer.draw({ placement: placement('a'), style });
    expect(rowTexts(layer)[0]?.style.fontSize).toBe(20);
  });
});
