import { type Container, type Sprite, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { AtlasFrame } from '../src/data/sprites/index.js';
import { BadgeLayer, type DoorBadge, type DoorBadgeRow } from '../src/gpu/overlays/badge-layer.js';
import { type ConstructionSign, ConstructionSignLayer } from '../src/gpu/overlays/construction-sign-layer.js';
import { type BuildingSignSheet, signRowAt } from '../src/gpu/overlays/sign-gfx.js';
import { TextureCache } from '../src/gpu/texture-cache.js';
import { makeElevationField, ONE, tileToScreen } from '../src/index.js';

/**
 * The door-badge layer is a projection consumer like the selection ring: it draws the app-computed
 * bottom-to-top row list at a building's sign-post anchor and rides the SAME terrain lift the sprite
 * pool applies. Pixi `Container`/`Graphics`/`Sprite` build without a GL context (geometry + transform
 * only), so the stack's child count and world-space position are agent-checkable here. Without decoded
 * sign art the layer draws the placeholder squares; with it, one player-coloured sign sprite per row -
 * chained rows base-cropped so no rock clump lands on the emblem below.
 */

const workers = (craftsmen: number, carriers: number, gatherers = 0): DoorBadgeRow[] => [
  ...Array.from({ length: craftsmen }, (): DoorBadgeRow => ({ role: 'craftsman' })),
  ...Array.from({ length: gatherers }, (): DoorBadgeRow => ({ role: 'gatherer' })),
  ...Array.from({ length: carriers }, (): DoorBadgeRow => ({ role: 'carrier' })),
];

const badge = (id: number, tileX: number, tileY: number, rows: readonly DoorBadgeRow[]): DoorBadge => ({
  id,
  x: tileX * ONE,
  y: tileY * ONE,
  rows,
});

/** The placeholder stack starts LOW, just below its anchor (badge-layer's STACK_BASE_DROP). Horizontal
 *  placement is the anchor's own - the app resolves the anchor, this layer adds no x offset. */
const DOOR_LIFT = -6;

/** A fake decoded sign sheet: one atlas page, distinct frame objects per kind (the texture cache keys
 *  by frame object, so kinds must not share). Frame geometry mirrors the real `ls_temp` bobs
 *  (h 33, offsetY -26), so the chain-crop cuts land inside it. */
function sheet(): BuildingSignSheet {
  const frame = (x: number): AtlasFrame => ({ x, y: 0, width: 25, height: 33, offsetX: -13, offsetY: -26 });
  return {
    source: new TextureSource({ width: 512, height: 64 }),
    frameByKind: {
      worker: frame(0),
      carrier: frame(26),
      single: frame(52),
      couple: frame(78),
      family: frame(104),
      construction: frame(130),
    },
  };
}

describe('BadgeLayer (placeholder squares)', () => {
  it('stacks one square per row at its anchor node', () => {
    const layer = new BadgeLayer();
    layer.draw([badge(1, 3, 5, workers(2, 1, 1))]);
    const stack = layer.container.children[0];
    expect(layer.container.children).toHaveLength(1); // one stack for the one building
    expect(stack?.children).toHaveLength(4); // 2 craftsmen + 1 gatherer + 1 carrier = 4 squares
    const anchor = tileToScreen(3, 5);
    expect(stack?.position.x).toBe(anchor.x);
    expect(stack?.position.y).toBe(anchor.y - DOOR_LIFT);
  });

  it('rebuilds a stack when its rows change and retires it when the building leaves the list', () => {
    const layer = new BadgeLayer();
    layer.draw([badge(1, 3, 5, workers(1, 0))]);
    expect(layer.container.children[0]?.children).toHaveLength(1);
    layer.draw([badge(1, 3, 5, workers(3, 0))]); // gained two workers
    expect(layer.container.children).toHaveLength(1);
    expect(layer.container.children[0]?.children).toHaveLength(3);
    layer.draw([]); // building unstaffed / gone
    expect(layer.container.children).toHaveLength(0);
  });

  it('draws no stack for a row-less badge', () => {
    const layer = new BadgeLayer();
    layer.draw([badge(1, 3, 5, [])]);
    expect(layer.container.children).toHaveLength(0);
  });

  it('culls off-screen badges: keeps the pooled stack (hidden), skips reposition, re-shows on scroll-in', () => {
    const layer = new BadgeLayer();
    // A viewport framing a small world box; the badge at tile (3,5) projects inside it.
    const onScreen = tileToScreen(3, 5);
    const vp = { minX: onScreen.x - 50, minY: onScreen.y - 50, maxX: onScreen.x + 50, maxY: onScreen.y + 50 };
    layer.draw([badge(1, 3, 5, workers(1, 0))], undefined, vp);
    const stack = layer.container.children[0];
    expect(stack?.visible).toBe(true); // in view → drawn
    const shownX = stack?.position.x;

    // Same building, now far outside the framed box: the stack stays POOLED but hidden and unmoved
    // (cost tracks the screen, not the map), and it is NOT retired the way an unstaffed building is.
    layer.draw([badge(1, 900, 900, workers(1, 0))], undefined, vp);
    expect(layer.container.children).toHaveLength(1); // still pooled, not destroyed
    expect(layer.container.children[0]?.visible).toBe(false); // hidden while off-screen
    expect(layer.container.children[0]?.position.x).toBe(shownX); // not repositioned off-screen

    // Scrolls back into view → shown and repositioned again.
    layer.draw([badge(1, 3, 5, workers(1, 0))], undefined, vp);
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
    layer.draw([badge(1, 3, 5, workers(1, 0)), badge(2, 900, 900, workers(1, 0))], undefined, vp);
    expect(layer.container.children).toHaveLength(1); // only building 1 has a stack

    // Building 1 leaves the list (demolished / unstaffed); building 2 is still off-screen and stackless.
    layer.draw([badge(2, 900, 900, workers(1, 0))], undefined, vp);
    expect(layer.container.children).toHaveLength(0); // building 1's stack retired, no ghost
  });

  it('lifts the stack by the terrain height at the anchor', () => {
    const W = 4;
    const H = 8;
    const elev = new Array<number>(W * H).fill(0);
    elev[6 * W + 1] = 160; // a hill under cell (col 1, row 6)
    const field = makeElevationField(elev, W, H);
    const layer = new BadgeLayer();
    layer.draw([badge(1, 1, 6, workers(1, 0))], field);
    const door = tileToScreen(1, 6);
    const y = layer.container.children[0]?.position.y ?? 0;
    expect(y).toBeCloseTo(door.y - field.liftAt(1, 6) - DOOR_LIFT, 6);
    expect(y).toBeLessThan(door.y - 100); // the hill lift is real, not a rounding wobble
  });
});

describe('BadgeLayer (decoded sign art)', () => {
  it('draws the rows as given, chained upward, cropping the base off every row above the first', () => {
    const layer = new BadgeLayer();
    const s = sheet();
    layer.setGfx({ byPlayer: [s], textures: new TextureCache() });
    layer.draw([badge(1, 3, 5, [{ role: 'single' }, { role: 'family' }, ...workers(2, 1, 1)])]);
    const stack = layer.container.children[0] as Container;
    expect(stack.children).toHaveLength(6); // 2 banners + 3 discs + 1 pennant
    // Chained upward: each row's sprite sits SIGN_STEP above the previous (same frame offsets here).
    const ys = stack.children.map((c) => c.position.y);
    for (let i = 1; i < ys.length; i++) expect((ys[i - 1] ?? 0) - (ys[i] ?? 0)).toBe(20);
    // The base row keeps its full frame (rock clump and all)…
    expect((stack.children[0] as Sprite).texture.frame.height).toBe(33);
    // …and every chained row draws its base-cropped variant (fixture offsetY -26: banner cut -5 → 22,
    // disc cut -2 → 25, pennant cut -3 → 24).
    expect((stack.children[1] as Sprite).texture.frame.height).toBe(22); // family banner
    expect((stack.children[2] as Sprite).texture.frame.height).toBe(25); // craftsman disc
    expect((stack.children[5] as Sprite).texture.frame.height).toBe(24); // carrier pennant on top
    // The sign stack anchors AT the node (no placeholder base drop).
    const anchor = tileToScreen(3, 5);
    expect(stack.position.y).toBe(anchor.y);
  });

  it('offsets the stack by the badge dx/dy - the GfxFlagPoint pixel anchor', () => {
    const layer = new BadgeLayer();
    layer.setGfx({ byPlayer: [sheet()], textures: new TextureCache() });
    layer.draw([{ ...badge(1, 3, 5, workers(1, 0)), dx: -6, dy: 29 }]);
    const anchor = tileToScreen(3, 5);
    const stack = layer.container.children[0];
    expect(stack?.position.x).toBe(anchor.x - 6);
    expect(stack?.position.y).toBe(anchor.y + 29);
  });

  it("falls back to player 0's sheet for a slot with no recolour, and rebuilds on player change", () => {
    const layer = new BadgeLayer();
    const p0 = sheet();
    layer.setGfx({ byPlayer: [p0], textures: new TextureCache() });
    layer.draw([{ ...badge(1, 3, 5, workers(1, 0)), player: 7 }]); // slot 7 has no bake → p0's sheet
    const first = layer.container.children[0] as Container;
    expect((first.children[0] as Sprite).texture.source).toBe(p0.source);

    layer.draw([{ ...badge(1, 3, 5, workers(1, 0)), player: 0 }]); // owner changed → stack rebuilt (same art)
    expect(layer.container.children).toHaveLength(1);
  });

  it('clearing the art retires every stack and the next draw uses the placeholder squares', () => {
    const layer = new BadgeLayer();
    layer.setGfx({ byPlayer: [sheet()], textures: new TextureCache() });
    layer.draw([badge(1, 3, 5, workers(1, 0))]);
    expect(layer.container.children).toHaveLength(1);
    layer.setGfx(undefined);
    expect(layer.container.children).toHaveLength(0);
    layer.draw([badge(1, 3, 5, workers(1, 0))]);
    const anchor = tileToScreen(3, 5);
    expect(layer.container.children[0]?.position.y).toBe(anchor.y - DOOR_LIFT); // placeholder base drop
  });

  it('applies the session owner→colour mapping when picking the sign sheet', () => {
    // A rostered map recolours owners away from slot ids; the sheet pick must follow the same map the
    // pooled sprites draw through, or a building's signs mismatch its settlers' clothing band.
    const p0 = sheet();
    const p2 = sheet();
    const layer = new BadgeLayer((player) => (player === 1 ? 2 : player));
    layer.setGfx({ byPlayer: [p0, undefined, p2], textures: new TextureCache() });
    layer.draw([{ ...badge(1, 3, 5, workers(1, 0)), player: 1 }]); // owner 1 → colour slot 2
    const stack = layer.container.children[0] as Container;
    expect((stack.children[0] as Sprite).texture.source).toBe(p2.source);
  });
});

describe('signRowAt', () => {
  it('maps anchor-relative points to the drawn rows: base band, chain bands, and the miss zones', () => {
    // Three rows: base emblem band (-26,-6] plus the clump below (to +8), then 20 px bands upward.
    expect(signRowAt(3, 0, 5)).toBe(0); // on the base's rock clump
    expect(signRowAt(3, 0, -10)).toBe(0); // on the base emblem
    expect(signRowAt(3, 0, -30)).toBe(1); // on the middle emblem
    expect(signRowAt(3, 0, -50)).toBe(2); // on the top emblem
    expect(signRowAt(3, 0, -70)).toBeNull(); // above the chain
    expect(signRowAt(3, 0, 12)).toBeNull(); // below the clump
    expect(signRowAt(3, 20, -10)).toBeNull(); // beside the stack
    expect(signRowAt(0, 0, -10)).toBeNull(); // no rows, nothing to hit
    expect(signRowAt(1, 0, -30)).toBeNull(); // the band above a 1-row stack is empty air
  });
});

describe('ConstructionSignLayer', () => {
  it('plants one construction sign per site at its anchor + px offset, retiring it when the site completes', () => {
    const layer = new ConstructionSignLayer();
    const s = sheet();
    layer.setGfx({ byPlayer: [s], textures: new TextureCache() });
    const sign: ConstructionSign = { id: 9, x: 4 * ONE, y: 2 * ONE, dx: 17, dy: 70 };
    layer.draw([sign]);
    expect(layer.container.children).toHaveLength(1);
    const node = layer.container.children[0] as Sprite;
    const p = tileToScreen(4, 2);
    expect(node.position.x).toBe(p.x + 17);
    expect(node.position.y).toBe(p.y + 70);
    layer.draw([]); // site completed
    expect(layer.container.children).toHaveLength(0);
  });

  it('draws no construction sign without decoded art (the plot overlay already marks the site)', () => {
    const layer = new ConstructionSignLayer();
    layer.draw([{ id: 9, x: 4 * ONE, y: 2 * ONE }]);
    expect(layer.container.children).toHaveLength(0);
  });
});
