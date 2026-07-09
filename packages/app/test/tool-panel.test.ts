import { describe, expect, it } from 'vitest';
import { bakedIconOrigin } from '../src/hud/icon-texture.js';
import {
  BUILDING_CATEGORIES,
  type MenuBuildingEntry,
  buildingsInCategory,
  categoryOfKind,
  hitTestBuildingMenu,
  layoutBuildingMenu,
} from '../src/hud/tool-panel/building-menu.js';
import {
  DEFAULT_GAME_SPEED_CONTROL,
  GAME_SPEED_STATES,
  cycleGameSpeed,
  effectiveGameSpeedSpec,
  gameSpeedClickCause,
  gameSpeedSpec,
  toggleGameSpeedPause,
} from '../src/hud/tool-panel/game-speed.js';
import {
  DEFAULT_UI_SCALE,
  TOOL_BUTTONS,
  buildToolPanelLayout,
  hitTestToolPanel,
  pointOverToolPanel,
} from '../src/hud/tool-panel/layout.js';
import { type LoopSpeedControl, applyGameSpeed } from '../src/view/game-tool-panel.js';

/**
 * Headless tests for the LEFT tool panel's pure logic — the geometry hit-test, the speed state machine,
 * and the building-menu model. The agent self-validates these; the browser `?scene=sandbox` view is
 * where a human judges the pixels (crisp art, palette colours, Polish strings). See docs/SCENES.md.
 */

describe('tool-panel-layout', () => {
  it('scales the pinned design rects by the uiscale, anchored top-left', () => {
    const l1 = buildToolPanelLayout(1);
    const l2 = buildToolPanelLayout(2);
    // Strip is design (0,10,50,433): at 1× the right edge is 50, at 2× it is 100.
    expect(l1.strip).toEqual({ x: 0, y: 10, w: 50, h: 433 });
    expect(l2.strip).toEqual({ x: 0, y: 20, w: 100, h: 866 });
    expect(l1.width).toBe(50);
    expect(l2.width).toBe(100);
    // The buildings button is design (0,41,40,35).
    const b1 = l1.buttons.find((b) => b.id === 'buildings');
    expect(b1?.placed).toEqual({ x: 0, y: 41, w: 40, h: 35 });
  });

  it('keeps a fractional uiscale and clamps a sub-1 one to ≥ 1', () => {
    // Fractional scales pass through (the strip grows by the exact factor) …
    expect(buildToolPanelLayout(1.2).scale).toBe(1.2);
    expect(buildToolPanelLayout(1.2).width).toBeCloseTo(60);
    // … while sub-1 / negative values clamp up to 1.
    expect(buildToolPanelLayout(0).scale).toBe(1);
    expect(buildToolPanelLayout(-3).scale).toBe(1);
    expect(DEFAULT_UI_SCALE).toBe(1.4);
  });

  it('reports the design-space bounds the supersample texture must cover', () => {
    // The union of the strip (0,10,50,433) and every button (all inside it) is the strip rect itself —
    // scale-independent (pre-scale design space), so the off-screen texture is sized once from this.
    expect(buildToolPanelLayout(1).designBounds).toEqual({ x: 0, y: 10, w: 50, h: 433 });
    expect(buildToolPanelLayout(1.2).designBounds).toEqual({ x: 0, y: 10, w: 50, h: 433 });
  });

  it('hit-tests the button under a point and returns null off the buttons', () => {
    const l = buildToolPanelLayout(2);
    const speed = l.buttons.find((b) => b.id === 'speed');
    if (speed === undefined) throw new Error('missing speed button');
    const cx = speed.placed.x + speed.placed.w / 2;
    const cy = speed.placed.y + speed.placed.h / 2;
    expect(hitTestToolPanel(l, cx, cy)).toBe('speed');
    // A point on the strip but in a gap between buttons hits no button.
    expect(hitTestToolPanel(l, 2, 2)).toBeNull();
    // Off the strip entirely.
    expect(hitTestToolPanel(l, 5000, 5000)).toBeNull();
  });

  it('claims any point over the strip for the HUD (input routing predicate)', () => {
    const l = buildToolPanelLayout(2);
    expect(pointOverToolPanel(l, 10, 30)).toBe(true); // inside the strip
    expect(pointOverToolPanel(l, 10, 5)).toBe(false); // above the strip top (y<20)
    expect(pointOverToolPanel(l, 200, 30)).toBe(false); // right of the strip
  });

  it('carries the pinned original gfx ids for every button', () => {
    const byId = new Map(TOOL_BUTTONS.map((b) => [b.id, b.gfx]));
    expect(byId.get('buildings')).toBe(0x2a);
    expect(byId.get('statistics')).toBe(0x32);
    expect(byId.get('speed')).toBe(0x31);
  });
});

describe('baked-icon placement', () => {
  it('centres horizontally and BOTTOM-anchors vertically (the Y-flip compensation)', () => {
    // A 40×40 icon in a 60×60 rect at (100,200): centred x = 100 + 30 − 20 = 110; the Y-flip draws the
    // sprite upward from its origin, so y anchors at the box BOTTOM = 200 + 30 + 20 = 250 (centre + h/2).
    expect(bakedIconOrigin({ x: 100, y: 200, w: 60, h: 60 }, 40, 40)).toEqual({ x: 110, y: 250 });
    // A different width/height still centres in x and bottom-anchors in y.
    expect(bakedIconOrigin({ x: 0, y: 0, w: 50, h: 50 }, 30, 20)).toEqual({ x: 10, y: 35 });
    // Fractional midpoints are pixel-snapped (round), so the icon lands on whole screen pixels.
    expect(bakedIconOrigin({ x: 0, y: 0, w: 55, h: 55 }, 40, 40)).toEqual({ x: 8, y: 48 });
  });
});

describe('game-speed', () => {
  it('clicks cycle the RUNNING speeds only: normal → fast → faster → normal (never into pause)', () => {
    expect(DEFAULT_GAME_SPEED_CONTROL).toEqual({ running: 'normal', paused: false });
    let c = DEFAULT_GAME_SPEED_CONTROL;
    c = cycleGameSpeed(c);
    expect(c.running).toBe('fast');
    c = cycleGameSpeed(c);
    expect(c.running).toBe('faster');
    c = cycleGameSpeed(c);
    expect(c).toEqual({ running: 'normal', paused: false });
  });

  it('P toggles pause, remembering the running speed and restoring it on unpause', () => {
    const fast = cycleGameSpeed(DEFAULT_GAME_SPEED_CONTROL); // ×2
    const paused = toggleGameSpeedPause(fast);
    expect(paused).toEqual({ running: 'fast', paused: true });
    expect(effectiveGameSpeedSpec(paused).tickMultiplier).toBe(0); // the loop stops
    expect(effectiveGameSpeedSpec(paused).gfx).toBe(0x36); // the button shows the pause glyph
    const resumed = toggleGameSpeedPause(paused);
    expect(resumed).toEqual({ running: 'fast', paused: false });
    expect(effectiveGameSpeedSpec(resumed).tickMultiplier).toBe(2); // back at the pre-pause speed
  });

  it('a click while paused resumes at the remembered speed instead of advancing the cycle', () => {
    const paused = toggleGameSpeedPause({ running: 'faster', paused: false });
    expect(cycleGameSpeed(paused)).toEqual({ running: 'faster', paused: false });
  });

  it('a click-resume reports pause-toggle, so a fractional seed survives it exactly like P', () => {
    // Boot ?speed=0.5, pause with P, then resume by CLICKING the pause glyph. The click's cause comes
    // from the PRE-click state (gameSpeedClickCause) — reporting 'cycle' there would clobber the seed
    // to the discrete ×1, making the two resume gestures (click vs P) diverge.
    const control: LoopSpeedControl = { paused: false, speed: 0.5 };
    let c = toggleGameSpeedPause(DEFAULT_GAME_SPEED_CONTROL);
    applyGameSpeed(control, effectiveGameSpeedSpec(c), 'pause-toggle');
    expect(control).toEqual({ paused: true, speed: 0.5 });
    const cause = gameSpeedClickCause(c);
    expect(cause).toBe('pause-toggle'); // a click while paused = un-pause, not a speed pick
    c = cycleGameSpeed(c);
    applyGameSpeed(control, effectiveGameSpeedSpec(c), cause);
    expect(control).toEqual({ paused: false, speed: 0.5 });
    // While running, a click IS an explicit speed pick.
    expect(gameSpeedClickCause(c)).toBe('cycle');
  });

  it('a pause toggle never overwrites the loop multiplier — a fractional ?speed= seed survives P/P', () => {
    // Boot with ?speed=0.5, pause with P, resume with P: still 0.5 (a pause toggle only flips the flag).
    const control: LoopSpeedControl = { paused: false, speed: 0.5 };
    applyGameSpeed(control, gameSpeedSpec('paused'), 'pause-toggle');
    expect(control).toEqual({ paused: true, speed: 0.5 });
    applyGameSpeed(control, gameSpeedSpec('normal'), 'pause-toggle');
    expect(control).toEqual({ paused: false, speed: 0.5 });
    // A button CLICK is an explicit speed pick: it writes the discrete multiplier (and un-pauses).
    applyGameSpeed(control, gameSpeedSpec('fast'), 'cycle');
    expect(control).toEqual({ paused: false, speed: 2 });
  });

  it('maps each state to the pinned gfx family and a tick multiplier == factor', () => {
    expect(gameSpeedSpec('normal').gfx).toBe(0x31);
    expect(gameSpeedSpec('fast').gfx).toBe(0x34);
    expect(gameSpeedSpec('faster').gfx).toBe(0x35);
    expect(gameSpeedSpec('paused').gfx).toBe(0x36);
    for (const spec of GAME_SPEED_STATES) {
      expect(spec.tickMultiplier).toBe(spec.factor);
    }
    // Pausing stops the sim (multiplier 0); faster runs the accumulator 3×.
    expect(gameSpeedSpec('paused').tickMultiplier).toBe(0);
    expect(gameSpeedSpec('faster').tickMultiplier).toBe(3);
  });
});

describe('building-menu', () => {
  const entries: readonly MenuBuildingEntry[] = [
    { typeId: 1, label: 'Headquarters', kind: 'storage' },
    { typeId: 2, label: 'Home', kind: 'home' },
    { typeId: 12, label: 'Grain farm', kind: 'workplace' },
    { typeId: 39, label: 'Barracks', kind: 'training' },
    { typeId: 40, label: 'Watchtower', kind: 'tower' },
  ];

  it('has the five original category tabs with pinned string ids', () => {
    expect(BUILDING_CATEGORIES.map((c) => c.id)).toEqual(['all', 'work', 'storage', 'home', 'military']);
    expect(BUILDING_CATEGORIES.map((c) => c.label)).toEqual([
      'Wszystko',
      'Praca',
      'Magazyn',
      'Dom',
      'Wojsko',
    ]);
    expect(BUILDING_CATEGORIES.map((c) => c.stringId)).toEqual([2, 3, 4, 5, 6]);
  });

  it('folds kinds into categories (tower + training → military)', () => {
    expect(categoryOfKind('workplace')).toBe('work');
    expect(categoryOfKind('storage')).toBe('storage');
    expect(categoryOfKind('home')).toBe('home');
    expect(categoryOfKind('tower')).toBe('military');
    expect(categoryOfKind('training')).toBe('military');
  });

  it('filters entries by category, with `all` returning everything', () => {
    expect(buildingsInCategory(entries, 'all')).toHaveLength(5);
    expect(buildingsInCategory(entries, 'home').map((e) => e.typeId)).toEqual([2]);
    expect(buildingsInCategory(entries, 'military').map((e) => e.typeId)).toEqual([39, 40]);
    expect(buildingsInCategory(entries, 'work').map((e) => e.typeId)).toEqual([12]);
  });

  it('lays out and hit-tests the menu (tab, building, close, window, miss)', () => {
    const layout = layoutBuildingMenu(entries, { originX: 100, originY: 50, scale: 2, selected: 'all' });
    expect(layout.rows).toHaveLength(5); // `all` shows every entry
    expect(layout.tabs).toHaveLength(5);

    // A tab hit returns its category.
    const workTab = layout.tabs.find((t) => t.category === 'work');
    if (workTab === undefined) throw new Error('missing work tab');
    expect(hitTestBuildingMenu(layout, workTab.rect.x + 1, workTab.rect.y + 1)).toEqual({
      kind: 'tab',
      category: 'work',
    });

    // A row hit returns its building typeId.
    const farmRow = layout.rows.find((r) => r.typeId === 12);
    if (farmRow === undefined) throw new Error('missing farm row');
    expect(hitTestBuildingMenu(layout, farmRow.rect.x + 1, farmRow.rect.y + 1)).toEqual({
      kind: 'building',
      typeId: 12,
    });

    // The close box.
    expect(hitTestBuildingMenu(layout, layout.closeRect.x + 1, layout.closeRect.y + 1)).toEqual({
      kind: 'close',
    });

    // Inside the window but off every element → 'window' (still claimed, not a miss).
    expect(hitTestBuildingMenu(layout, layout.window.x + 1, layout.window.y + layout.window.h - 2)).toEqual({
      kind: 'window',
    });

    // Fully outside → null.
    expect(hitTestBuildingMenu(layout, 5000, 5000)).toBeNull();
  });

  it('selecting a category shrinks the visible rows', () => {
    const layout = layoutBuildingMenu(entries, { originX: 0, originY: 0, scale: 1, selected: 'military' });
    expect(layout.rows.map((r) => r.typeId)).toEqual([39, 40]);
  });

  // A longer list so the viewport overflows and the scroll model engages.
  const manyEntries: readonly MenuBuildingEntry[] = Array.from({ length: 10 }, (_, i) => ({
    typeId: 100 + i,
    label: `B${i}`,
    kind: 'workplace',
  }));

  it('bounds the list to a viewport, exposes a clamped scroll + a scrollbar on overflow', () => {
    const base = { originX: 0, originY: 0, scale: 1, selected: 'all' as const, maxListRows: 4 };
    const top = layoutBuildingMenu(manyEntries, base);
    // Only the viewport's worth of rows are materialised (the visible slice), from the top.
    expect(top.rows.map((r) => r.typeId)).toEqual([100, 101, 102, 103]);
    expect(top.scroll).toEqual({ top: 0, max: 6, total: 10, visible: 4 });
    expect(top.scrollbar).toBeDefined();

    // Scrolling down slides the window; the slice tracks `scrollTop`.
    const mid = layoutBuildingMenu(manyEntries, { ...base, scrollTop: 2 });
    expect(mid.rows.map((r) => r.typeId)).toEqual([102, 103, 104, 105]);
    expect(mid.scroll.top).toBe(2);

    // An over-scroll is clamped to the last full page.
    const clamped = layoutBuildingMenu(manyEntries, { ...base, scrollTop: 99 });
    expect(clamped.scroll.top).toBe(6);
    expect(clamped.rows.map((r) => r.typeId)).toEqual([106, 107, 108, 109]);
  });

  it('omits the scrollbar when the category fits the viewport', () => {
    const layout = layoutBuildingMenu(manyEntries, {
      originX: 0,
      originY: 0,
      scale: 1,
      selected: 'all',
      maxListRows: 20,
    });
    expect(layout.rows).toHaveLength(10);
    expect(layout.scrollbar).toBeUndefined();
    expect(layout.scroll.max).toBe(0);
  });

  it('hit-tests the scrollbar track as a page-scroll toward the click', () => {
    const layout = layoutBuildingMenu(manyEntries, {
      originX: 0,
      originY: 0,
      scale: 1,
      selected: 'all',
      maxListRows: 4,
      scrollTop: 3,
    });
    const bar = layout.scrollbar;
    if (bar === undefined) throw new Error('expected a scrollbar');
    // Above the thumb → page up; below → page down.
    expect(hitTestBuildingMenu(layout, bar.track.x + 1, bar.thumb.y - 1)).toEqual({
      kind: 'scroll',
      dir: -1,
    });
    expect(hitTestBuildingMenu(layout, bar.track.x + 1, bar.thumb.y + bar.thumb.h + 1)).toEqual({
      kind: 'scroll',
      dir: 1,
    });
    // On the thumb itself → consumed as window (no-op), never a fall-through.
    expect(hitTestBuildingMenu(layout, bar.thumb.x + 1, bar.thumb.y + 1)).toEqual({ kind: 'window' });
  });
});
