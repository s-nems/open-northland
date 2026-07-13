import { describe, expect, it } from 'vitest';
import { BadgeLayer, type DoorBadge } from '../src/gpu/overlays/badge-layer.js';
import { makeElevationField, ONE, tileToScreen } from '../src/index.js';

/**
 * The door-badge layer is a projection consumer like the selection ring: it stacks one square per
 * bound worker at a building's door node and rides the SAME terrain lift the sprite pool applies. Pixi
 * `Container`/`Graphics` build without a GL context (geometry + transform only), so the stack's child
 * count and world-space position are agent-checkable here.
 */

const badge = (
  id: number,
  tileX: number,
  tileY: number,
  craftsmen: number,
  carriers: number,
  gatherers = 0,
): DoorBadge => ({
  id,
  x: tileX * ONE,
  y: tileY * ONE,
  craftsmen,
  carriers,
  gatherers,
});

/** The stack starts LOW, just below its anchor (badge-layer's DOOR_LIFT). Horizontal placement is the
 *  anchor's own — the app resolves the worker-icon node beside the door, this layer adds no x offset. */
const DOOR_LIFT = -6;

describe('BadgeLayer', () => {
  it('stacks one square per bound worker (craftsmen + carriers + gatherers) at its anchor node', () => {
    const layer = new BadgeLayer();
    layer.draw([badge(1, 3, 5, 2, 1, 1)]);
    const stack = layer.container.children[0];
    expect(layer.container.children).toHaveLength(1); // one stack for the one building
    expect(stack?.children).toHaveLength(4); // 2 craftsmen + 1 carrier + 1 gatherer = 4 squares
    const anchor = tileToScreen(3, 5);
    expect(stack?.position.x).toBe(anchor.x);
    expect(stack?.position.y).toBe(anchor.y - DOOR_LIFT);
  });

  it('rebuilds a stack when its counts change and retires it when the building leaves the list', () => {
    const layer = new BadgeLayer();
    layer.draw([badge(1, 3, 5, 1, 0)]);
    expect(layer.container.children[0]?.children).toHaveLength(1);
    layer.draw([badge(1, 3, 5, 3, 0)]); // gained two workers
    expect(layer.container.children).toHaveLength(1);
    expect(layer.container.children[0]?.children).toHaveLength(3);
    layer.draw([]); // building unstaffed / gone
    expect(layer.container.children).toHaveLength(0);
  });

  it('draws no stack for a zero-count badge', () => {
    const layer = new BadgeLayer();
    layer.draw([badge(1, 3, 5, 0, 0)]);
    expect(layer.container.children).toHaveLength(0);
  });

  it('culls off-screen badges: keeps the pooled stack (hidden), skips reposition, re-shows on scroll-in', () => {
    const layer = new BadgeLayer();
    // A viewport framing a small world box; the badge at tile (3,5) projects inside it.
    const onScreen = tileToScreen(3, 5);
    const vp = { minX: onScreen.x - 50, minY: onScreen.y - 50, maxX: onScreen.x + 50, maxY: onScreen.y + 50 };
    layer.draw([badge(1, 3, 5, 1, 0)], undefined, vp);
    const stack = layer.container.children[0];
    expect(stack?.visible).toBe(true); // in view → drawn
    const shownX = stack?.position.x;

    // Same building, now far outside the framed box: the stack stays POOLED but hidden and unmoved
    // (cost tracks the screen, not the map), and it is NOT retired the way an unstaffed building is.
    layer.draw([badge(1, 900, 900, 1, 0)], undefined, vp);
    expect(layer.container.children).toHaveLength(1); // still pooled, not destroyed
    expect(layer.container.children[0]?.visible).toBe(false); // hidden while off-screen
    expect(layer.container.children[0]?.position.x).toBe(shownX); // not repositioned off-screen

    // Scrolls back into view → shown and repositioned again.
    layer.draw([badge(1, 3, 5, 1, 0)], undefined, vp);
    expect(layer.container.children[0]?.visible).toBe(true);
  });

  it('retires an on-screen stack even with an off-screen never-built staffed building present', () => {
    // Regression: `drawn` must stay a subset of the pooled stacks. An off-screen building that never built
    // a stack must NOT be marked drawn, or retireUndrawn's `pool.size <= drawn.size` fast-path would skip a
    // genuinely-orphaned on-screen stack — leaving a ghost badge that never gets destroyed.
    const layer = new BadgeLayer();
    const onScreen = tileToScreen(3, 5);
    const vp = { minX: onScreen.x - 50, minY: onScreen.y - 50, maxX: onScreen.x + 50, maxY: onScreen.y + 50 };
    // Building 1 on-screen (builds a stack); building 2 staffed but off-screen and never builds one.
    layer.draw([badge(1, 3, 5, 1, 0), badge(2, 900, 900, 1, 0)], undefined, vp);
    expect(layer.container.children).toHaveLength(1); // only building 1 has a stack

    // Building 1 leaves the list (demolished / unstaffed); building 2 is still off-screen and stackless.
    layer.draw([badge(2, 900, 900, 1, 0)], undefined, vp);
    expect(layer.container.children).toHaveLength(0); // building 1's stack retired, no ghost
  });

  it('lifts the stack by the terrain height at the door', () => {
    const W = 4;
    const H = 8;
    const elev = new Array<number>(W * H).fill(0);
    elev[6 * W + 1] = 160; // a hill under cell (col 1, row 6)
    const field = makeElevationField(elev, W, H);
    const layer = new BadgeLayer();
    layer.draw([badge(1, 1, 6, 1, 0)], field);
    const door = tileToScreen(1, 6);
    const y = layer.container.children[0]?.position.y ?? 0;
    expect(y).toBeCloseTo(door.y - field.liftAt(1, 6) - DOOR_LIFT, 6);
    expect(y).toBeLessThan(door.y - 100); // the hill lift is real, not a rounding wobble
  });
});
