import { describe, expect, it } from 'vitest';
import { BadgeLayer, type DoorBadge } from '../src/gpu/badge-layer.js';
import { ONE, makeElevationField, tileToScreen } from '../src/index.js';

/**
 * The door-badge layer is a projection consumer like the selection ring: it stacks one square per
 * bound worker at a building's door node and rides the SAME terrain lift the sprite pool applies. Pixi
 * `Container`/`Graphics` build without a GL context (geometry + transform only), so the stack's child
 * count and world-space position are agent-checkable here.
 */

const badge = (id: number, tileX: number, tileY: number, workers: number, carriers: number): DoorBadge => ({
  id,
  x: tileX * ONE,
  y: tileY * ONE,
  workers,
  carriers,
});

/** The stack sits BESIDE the door and a touch above it (badge-layer's OFFSET_X / DOOR_LIFT). */
const OFFSET_X = 10;
const DOOR_LIFT = 6;

describe('BadgeLayer', () => {
  it('stacks one square per bound worker (carriers + workers) at the door node', () => {
    const layer = new BadgeLayer();
    layer.draw([badge(1, 3, 5, 2, 1)]);
    const stack = layer.container.children[0];
    expect(layer.container.children).toHaveLength(1); // one stack for the one building
    expect(stack?.children).toHaveLength(3); // 2 workers + 1 carrier = 3 squares
    const door = tileToScreen(3, 5);
    expect(stack?.position.x).toBe(door.x + OFFSET_X);
    expect(stack?.position.y).toBe(door.y - DOOR_LIFT);
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
