import { Container, type Sprite, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { SIGN_DEPTH_EPS, screenDepth } from '../src/data/scene/index.js';
import type { AtlasFrame } from '../src/data/sprites/index.js';
import { BadgeLayer } from '../src/gpu/overlays/badge-layer.js';
import { type ConstructionSign, ConstructionSignLayer } from '../src/gpu/overlays/construction-sign-layer.js';
import { badgeAnchor, type DoorBadge } from '../src/gpu/overlays/door-badge.js';
import {
  GARRISON_STAR_MAX,
  GARRISON_TICKS_PER_FRAME,
  garrisonFlagLoop,
  hitsGarrisonFlag,
} from '../src/gpu/overlays/garrison-flag.js';
import {
  type BuildingSignSheet,
  CONSTRUCTION_SIGN_DX,
  type DoorBadgeRow,
  signRowAt,
} from '../src/gpu/overlays/sign-gfx.js';
import { TextureCache } from '../src/gpu/texture-cache.js';
import { makeElevationField, ONE, tileToScreen } from '../src/index.js';

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

/** `root` stands in for the renderer's shared depth-sorted sprite layer, where drawn stacks land. */
function layerIn(colourOf?: (player: number) => number): { layer: BadgeLayer; root: Container } {
  const root = new Container();
  return { layer: new BadgeLayer(root, colourOf), root };
}

/** A fake decoded sign sheet. The texture cache keys by frame object, so kinds must not share one, and
 *  the geometry mirrors the real `ls_temp` bobs (h 33, offsetY -26) so the chain-crop cuts land inside it. */
function sheet(garrison?: readonly (readonly AtlasFrame[])[]): BuildingSignSheet {
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
    ...(garrison !== undefined ? { garrison } : {}),
  };
}

/** Five wave loops of `WAVE` frames, each frame a distinct object with a distinct width so a test can
 *  name the frame drawn. Geometry mirrors the real `soldier` bobs (46x43 at offset -4,-38). */
const WAVE = 8;
function garrisonSheet(): { sheet: BuildingSignSheet; frames: readonly (readonly AtlasFrame[])[] } {
  const frames = Array.from({ length: 5 }, (_, star) =>
    Array.from(
      { length: WAVE },
      (_unused, i): AtlasFrame => ({
        x: i * 48,
        y: 200 + star * 44,
        width: 46 + i,
        height: 43,
        offsetX: -4,
        offsetY: -38,
      }),
    ),
  );
  return { sheet: sheet(frames), frames };
}

/** The committed viking small-tower flag offset. */
const MAST = { dx: -4, dy: -228 };

/** A mark's inset into its band plus its outline stroke - how far a click can land off the ink. */
const MARK_BAND_SLACK = 4;
/** The flag box's left and bottom edges, which the wave frames reach and the straight placeholder does not. */
const FLAG_BAND_SLACK = 6;

const manned = (id: number, tileX: number, tileY: number, stars: number): DoorBadge => ({
  ...badge(id, tileX, tileY, []),
  garrison: { stars, ...MAST },
});

/** The furthest a point the picker accepts sits outside `bounds`, 0 when the ink covers every such point.
 *  Probed through the hit test itself, so a drawn mark cannot pass by restating the box it derives from. */
function worstUncoveredReach(
  hit: (dx: number, dy: number) => boolean,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  range: number,
): number {
  let worst = 0;
  for (let dx = -range; dx <= range; dx++) {
    for (let dy = -range; dy <= range; dy++) {
      if (!hit(dx, dy)) continue;
      worst = Math.max(worst, bounds.minX - dx, dx - bounds.maxX, bounds.minY - dy, dy - bounds.maxY);
    }
  }
  return Math.max(worst, 0);
}

/** The mark standing at the mast, picked by position so the test does not pin the layer's attach order. */
function flagOf(root: Container, tileX: number, tileY: number): Container | undefined {
  const mast = tileToScreen(tileX, tileY).y + MAST.dy;
  return root.children.find((c) => c.position.y === mast) as Container | undefined;
}

function flownFrame(root: Container, tileX: number, tileY: number): Sprite['texture']['frame'] {
  const sprite = flagOf(root, tileX, tileY)?.children[0] as Sprite | undefined;
  if (sprite === undefined) throw new Error('no flag flying at the mast');
  return sprite.texture.frame;
}

describe('BadgeLayer (placeholder marks)', () => {
  it('draws every mark inside the pick band its own row resolves to', () => {
    const { layer, root } = layerIn();
    const rows: DoorBadgeRow[] = [{ role: 'single' }, ...workers(1, 1, 1)];
    layer.draw([badge(1, 3, 5, rows)]);
    const marks = (root.children[0] as Container).children;
    expect(marks).toHaveLength(rows.length);
    marks.forEach((mark, row) => {
      const b = mark.getLocalBounds();
      for (const x of [b.minX, b.maxX]) {
        for (const y of [b.minY, b.maxY]) {
          expect(signRowAt(rows.length, x, y)).toBe(row);
        }
      }
    });
  });

  it('centres the stack on the post the picker measures from', () => {
    const { layer, root } = layerIn();
    layer.draw([{ ...badge(1, 3, 5, workers(2, 1)), hearts: true }]);
    const b = (root.children[0] as Container).getLocalBounds();
    expect(b.minX).toBeCloseTo(-b.maxX, 6);
  });

  it('fills its band, so grass beside a mark is not a click on that mark', () => {
    const { layer, root } = layerIn();
    const rows = workers(2, 0);
    layer.draw([badge(1, 3, 5, rows)]);
    // The row above the base has no rock-clump skirt below it, so its whole band should be under ink.
    const mark = (root.children[0] as Container).children[1];
    if (mark === undefined) throw new Error('no second mark drawn');
    const reach = worstUncoveredReach(
      (dx, dy) => signRowAt(rows.length, dx, dy) === 1,
      mark.getLocalBounds(),
      80,
    );
    expect(reach).toBeLessThanOrEqual(MARK_BAND_SLACK);
  });

  it('stacks one mark per row at its anchor node', () => {
    const { layer, root } = layerIn();
    layer.draw([badge(1, 3, 5, workers(2, 1, 1))]);
    const stack = root.children[0];
    expect(root.children).toHaveLength(1);
    expect(stack?.children).toHaveLength(4);
    const anchor = tileToScreen(3, 5);
    expect(stack?.position.x).toBe(anchor.x);
    expect(stack?.position.y).toBe(anchor.y);
  });

  it('rebuilds a stack when its rows change and retires it when the building leaves the list', () => {
    const { layer, root } = layerIn();
    layer.draw([badge(1, 3, 5, workers(1, 0))]);
    expect(root.children[0]?.children).toHaveLength(1);
    layer.draw([badge(1, 3, 5, workers(3, 0))]);
    expect(root.children).toHaveLength(1);
    expect(root.children[0]?.children).toHaveLength(3);
    layer.draw([]);
    expect(root.children).toHaveLength(0);
  });

  it('draws no stack for a row-less badge', () => {
    const { layer, root } = layerIn();
    layer.draw([badge(1, 3, 5, [])]);
    expect(root.children).toHaveLength(0);
  });

  it('culls off-screen badges: detaches the pooled stack, skips reposition, re-attaches on scroll-in', () => {
    const { layer, root } = layerIn();
    const onScreen = tileToScreen(3, 5);
    const vp = { minX: onScreen.x - 50, minY: onScreen.y - 50, maxX: onScreen.x + 50, maxY: onScreen.y + 50 };
    layer.draw([badge(1, 3, 5, workers(1, 0))], undefined, vp);
    const stack = root.children[0];
    expect(stack?.visible).toBe(true);
    const shownX = stack?.position.x;

    // Off-screen it leaves the sprite layer, whose depth sort walks its children every frame.
    layer.draw([badge(1, 900, 900, workers(1, 0))], undefined, vp);
    expect(root.children).toHaveLength(0);
    expect(stack?.destroyed).toBe(false);
    expect(stack?.position.x).toBe(shownX);

    layer.draw([badge(1, 3, 5, workers(1, 0))], undefined, vp);
    expect(root.children[0]).toBe(stack);
    expect(stack?.visible).toBe(true);
  });

  it('retires an on-screen stack even with an off-screen never-built staffed building present', () => {
    // `drawn` must stay a subset of the pooled stacks: marking a never-built off-screen building drawn
    // would let retireUndrawn's `pool.size <= drawn.size` fast-path skip a genuinely orphaned stack.
    const { layer, root } = layerIn();
    const onScreen = tileToScreen(3, 5);
    const vp = { minX: onScreen.x - 50, minY: onScreen.y - 50, maxX: onScreen.x + 50, maxY: onScreen.y + 50 };
    layer.draw([badge(1, 3, 5, workers(1, 0)), badge(2, 900, 900, workers(1, 0))], undefined, vp);
    expect(root.children).toHaveLength(1);

    layer.draw([badge(2, 900, 900, workers(1, 0))], undefined, vp);
    expect(root.children).toHaveLength(0);
  });

  it('lifts the stack by the terrain height at the anchor', () => {
    const W = 4;
    const H = 8;
    const elev = new Array<number>(W * H).fill(0);
    elev[6 * W + 1] = 160; // a hill under cell (col 1, row 6)
    const field = makeElevationField(elev, W, H);
    const { layer, root } = layerIn();
    layer.draw([badge(1, 1, 6, workers(1, 0))], field);
    const door = tileToScreen(1, 6);
    const y = root.children[0]?.position.y ?? 0;
    expect(y).toBeCloseTo(door.y - field.liftAt(1, 6), 6);
    expect(y).toBeLessThan(door.y - 100); // the hill lift is real, not a rounding wobble
    // The depth stays keyed to the pre-lift anchor, so occlusion sorts by map row while the chain rides
    // the hill.
    expect(root.children[0]?.zIndex).toBe(screenDepth(door.x, door.y, 'building') + SIGN_DEPTH_EPS);
  });

  it('sorts a stack just over its own building and under a settler in front of it', () => {
    const { layer, root } = layerIn();
    layer.draw([badge(1, 3, 5, workers(1, 0))]);
    const anchor = tileToScreen(3, 5);
    const depth = root.children[0]?.zIndex ?? 0;
    expect(depth).toBeGreaterThan(screenDepth(anchor.x, anchor.y, 'building'));
    expect(depth).toBeLessThan(screenDepth(anchor.x, anchor.y, 'settler'));
    const nearerRow = tileToScreen(3, 6);
    expect(depth).toBeLessThan(screenDepth(nearerRow.x, nearerRow.y, 'settler'));
  });

  it('keys the depth off the building even when the post is planted rows away', () => {
    // The `dy` cases are the shipped viking flag-point range: -23 (the smithy, planted behind its
    // anchor) to +130 (the mod's wall record). Against the shipped footprints 45 of the 46 types land
    // within 16 px of their own blocked front edge, so the band where keying at the post would invert
    // the order is doorstep-deep, never a whole visual row.
    const { layer, root } = layerIn();
    const anchor = tileToScreen(3, 5);
    const keyed = screenDepth(anchor.x, anchor.y, 'building') + SIGN_DEPTH_EPS;
    for (const dy of [-23, 67, 130]) {
      layer.draw([{ ...badge(1, 3, 5, workers(1, 0)), dy }]);
      const stack = root.children[0];
      expect(stack?.position.y).toBe(anchor.y + dy);
      expect(stack?.zIndex).toBe(keyed);
    }
  });
});

describe('BadgeLayer (decoded sign art)', () => {
  it('draws the rows as given, chained upward, cropping the base off every row above the first', () => {
    const { layer, root } = layerIn();
    const s = sheet();
    layer.setGfx({ byPlayer: [s], textures: new TextureCache() });
    layer.draw([badge(1, 3, 5, [{ role: 'single' }, { role: 'family' }, ...workers(2, 1, 1)])]);
    const stack = root.children[0] as Container;
    expect(stack.children).toHaveLength(6);
    // One SIGN_STEP per row, exact here because the fixture frames share offsets.
    const ys = stack.children.map((c) => c.position.y);
    for (let i = 1; i < ys.length; i++) expect((ys[i - 1] ?? 0) - (ys[i] ?? 0)).toBe(20);
    expect((stack.children[0] as Sprite).texture.frame.height).toBe(33);
    // Cropped heights follow the fixture's offsetY -26: banner cut -5 → 22, disc cut -2 → 25, pennant
    // cut -3 → 24.
    expect((stack.children[1] as Sprite).texture.frame.height).toBe(22);
    expect((stack.children[2] as Sprite).texture.frame.height).toBe(25);
    expect((stack.children[5] as Sprite).texture.frame.height).toBe(24);
    const anchor = tileToScreen(3, 5);
    expect(stack.position.y).toBe(anchor.y);
  });

  it('offsets the stack by the badge dx/dy - the GfxFlagPoint pixel anchor', () => {
    const { layer, root } = layerIn();
    layer.setGfx({ byPlayer: [sheet()], textures: new TextureCache() });
    layer.draw([{ ...badge(1, 3, 5, workers(1, 0)), dx: -6, dy: 29 }]);
    const anchor = tileToScreen(3, 5);
    const stack = root.children[0];
    expect(stack?.position.x).toBe(anchor.x - 6);
    expect(stack?.position.y).toBe(anchor.y + 29);
  });

  it("falls back to player 0's sheet for a slot with no recolour, and rebuilds on player change", () => {
    const { layer, root } = layerIn();
    const p0 = sheet();
    layer.setGfx({ byPlayer: [p0], textures: new TextureCache() });
    layer.draw([{ ...badge(1, 3, 5, workers(1, 0)), player: 7 }]); // slot 7 has no bake
    const first = root.children[0] as Container;
    expect((first.children[0] as Sprite).texture.source).toBe(p0.source);

    layer.draw([{ ...badge(1, 3, 5, workers(1, 0)), player: 0 }]);
    expect(root.children).toHaveLength(1);
  });

  it('clearing the art retires every stack and the next draw uses the placeholder squares', () => {
    const { layer, root } = layerIn();
    layer.setGfx({ byPlayer: [sheet()], textures: new TextureCache() });
    layer.draw([badge(1, 3, 5, workers(1, 0))]);
    expect(root.children).toHaveLength(1);
    layer.setGfx(undefined);
    expect(root.children).toHaveLength(0);
    layer.draw([badge(1, 3, 5, workers(1, 0))]);
    const anchor = tileToScreen(3, 5);
    expect(root.children[0]?.position.y).toBe(anchor.y);
  });

  it('leaves the borrowed sprite layer empty on destroy', () => {
    // The stacks live on a layer this one does not own, so teardown has to reach them itself.
    const { layer, root } = layerIn();
    layer.draw([badge(1, 3, 5, workers(1, 0)), badge(2, 4, 5, workers(1, 0))]);
    expect(root.children).toHaveLength(2);
    layer.destroy();
    expect(root.children).toHaveLength(0);
  });

  it('applies the session owner→colour mapping when picking the sign sheet', () => {
    // A rostered map recolours owners away from slot ids; a sheet picked by slot id would mismatch the
    // clothing band its settlers draw through.
    const p0 = sheet();
    const p2 = sheet();
    const { layer, root } = layerIn((player) => (player === 1 ? 2 : player));
    layer.setGfx({ byPlayer: [p0, undefined, p2], textures: new TextureCache() });
    layer.draw([{ ...badge(1, 3, 5, workers(1, 0)), player: 1 }]);
    const stack = root.children[0] as Container;
    expect((stack.children[0] as Sprite).texture.source).toBe(p2.source);
  });
});

describe('BadgeLayer (garrison flag)', () => {
  it('flies the flag at the mast, beside the chain, on the same building depth key', () => {
    const { layer, root } = layerIn();
    const { sheet: s } = garrisonSheet();
    layer.setGfx({ byPlayer: [s], textures: new TextureCache() });
    // A manned tower that also employs a hauler: one chain at the post, one flag on the roof.
    layer.draw([{ ...manned(1, 3, 5, 2), rows: workers(0, 1), dx: -6, dy: 29 }]);

    expect(root.children).toHaveLength(2);
    const anchor = tileToScreen(3, 5);
    const chain = root.children.find((c) => c.position.y === anchor.y + 29);
    const flag = flagOf(root, 3, 5);
    expect(chain).toBeDefined();
    expect(flag?.position.x).toBe(anchor.x + MAST.dx); // the mast, not the post the chain stands on
    expect(flag?.zIndex).toBe(screenDepth(anchor.x, anchor.y, 'building') + SIGN_DEPTH_EPS);
    expect(flag?.zIndex).toBe(chain?.zIndex);
  });

  it('draws the star record its post earned, and keeps flying the top one past it', () => {
    const { layer, root } = layerIn();
    const { sheet: s, frames } = garrisonSheet();
    layer.setGfx({ byPlayer: [s], textures: new TextureCache() });
    const flownAt = (stars: number): number => {
      layer.draw([manned(1, 3, 5, stars)]);
      return flownFrame(root, 3, 5).y;
    };
    expect(flownAt(1)).toBe(frames[0]?.[0]?.y);
    expect(flownAt(3)).toBe(frames[2]?.[0]?.y);
    expect(flownAt(5)).toBe(frames[4]?.[0]?.y);
    // The big tower employs eight bows; the art stops at five.
    expect(flownAt(8)).toBe(frames[4]?.[0]?.y);
  });

  it('waves on the render clock, and rebuilds only when the star count changes', () => {
    const { layer, root } = layerIn();
    const { sheet: s, frames } = garrisonSheet();
    layer.setGfx({ byPlayer: [s], textures: new TextureCache() });
    const drawnAt = (clock: number, stars = 2): number => {
      layer.draw([manned(1, 3, 5, stars)], undefined, undefined, clock);
      return flownFrame(root, 3, 5).width;
    };
    const loop = frames[1] ?? [];
    const step = GARRISON_TICKS_PER_FRAME;
    expect(drawnAt(0)).toBe(loop[0]?.width);
    expect(drawnAt(step - 1)).toBe(loop[0]?.width);
    expect(drawnAt(step)).toBe(loop[1]?.width);
    expect(drawnAt(step * WAVE)).toBe(loop[0]?.width);

    const two = flagOf(root, 3, 5);
    expect(drawnAt(0, 3)).toBe((frames[2] ?? [])[0]?.width);
    expect(flagOf(root, 3, 5)).not.toBe(two);
    expect(drawnAt(0, 5)).toBe((frames[4] ?? [])[0]?.width);
    const five = flagOf(root, 3, 5);
    drawnAt(0, 6);
    expect(flagOf(root, 3, 5)).toBe(five); // the star count is capped, so a sixth man draws no change
  });

  it('draws a placeholder mast without decoded art, and retires the flag with its building', () => {
    const { layer, root } = layerIn();
    layer.draw([manned(1, 3, 5, 2)]);
    // Two marks: the empty row list's chain node, and the flag.
    expect(root.children).toHaveLength(2);
    expect(flagOf(root, 3, 5)?.getLocalBounds().height).toBeGreaterThan(0);

    layer.draw([]);
    expect(root.children).toHaveLength(0);
  });

  it('spans the placeholder flag across the band the picker claims', () => {
    const { layer, root } = layerIn();
    layer.draw([manned(1, 3, 5, GARRISON_STAR_MAX)]);
    const b = flagOf(root, 3, 5)?.getLocalBounds();
    if (b === undefined) throw new Error('no flag flying at the mast');
    // Cloth stopping short of its own click box leaves clickable sky beside a marker 230 px up.
    expect(worstUncoveredReach(hitsGarrisonFlag, b, 80)).toBeLessThanOrEqual(FLAG_BAND_SLACK);
  });

  it('retires the flag with the chain when the art basis is swapped out', () => {
    const { layer, root } = layerIn();
    layer.setGfx({ byPlayer: [garrisonSheet().sheet], textures: new TextureCache() });
    layer.draw([manned(1, 3, 5, 2)]);
    expect(root.children).toHaveLength(2);
    // A flag left behind would keep drawing from an atlas nothing points at any more.
    layer.setGfx(undefined);
    expect(root.children).toHaveLength(0);
  });

  it('detaches the flag with its chain when the building scrolls off-screen', () => {
    const { layer, root } = layerIn();
    layer.setGfx({ byPlayer: [garrisonSheet().sheet], textures: new TextureCache() });
    const onScreen = tileToScreen(3, 5);
    const vp = { minX: onScreen.x - 50, minY: onScreen.y - 50, maxX: onScreen.x + 50, maxY: onScreen.y + 50 };
    layer.draw([manned(1, 3, 5, 2)], undefined, vp);
    expect(root.children).toHaveLength(2);

    layer.draw([manned(1, 900, 900, 2)], undefined, vp);
    expect(root.children).toHaveLength(0);
    layer.draw([manned(1, 3, 5, 2)], undefined, vp);
    expect(root.children).toHaveLength(2);
  });
});

describe('badgeAnchor', () => {
  it('is where the layer plants both marks, with the decoded art and without it', () => {
    const W = 4;
    const H = 8;
    const elev = new Array<number>(W * H).fill(0);
    elev[6 * W + 1] = 160;
    const field = makeElevationField(elev, W, H);
    const post: DoorBadge = {
      ...manned(1, 1, 6, 2),
      rows: workers(1, 1),
      dx: -6,
      dy: 29,
    };
    const anchor = badgeAnchor(post, field);

    for (const gfx of [undefined, { byPlayer: [garrisonSheet().sheet], textures: new TextureCache() }]) {
      const { layer, root } = layerIn();
      layer.setGfx(gfx);
      layer.draw([post], field);
      const drawn = root.children.map((c) => ({ x: c.position.x, y: c.position.y }));
      expect(drawn).toHaveLength(2); // the sign chain and the flag, nothing else
      expect(drawn).toContainEqual({ x: anchor.x, y: anchor.y });
      expect(drawn).toContainEqual(anchor.mast);
    }
  });
});

describe('garrisonFlagLoop', () => {
  it('caps at the five records the art authors, and flies nothing without a post or art', () => {
    const { sheet: s, frames } = garrisonSheet();
    expect(garrisonFlagLoop(s, 1)).toEqual(frames[0]);
    expect(garrisonFlagLoop(s, 5)).toEqual(frames[4]);
    expect(garrisonFlagLoop(s, 9)).toEqual(frames[4]);
    expect(garrisonFlagLoop(s, 0)).toBeUndefined();
    expect(garrisonFlagLoop(sheet(), 2)).toBeUndefined(); // a slot whose `soldier` records never resolved
    expect(garrisonFlagLoop(undefined, 2)).toBeUndefined();
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
  it('plants one construction sign per site beside its sign post, retiring it when the site completes', () => {
    const layer = new ConstructionSignLayer();
    const s = sheet();
    layer.setGfx({ byPlayer: [s], textures: new TextureCache() });
    const sign: ConstructionSign = { id: 9, x: 4 * ONE, y: 2 * ONE, dx: 17, dy: 70 };
    layer.draw([sign]);
    expect(layer.container.children).toHaveLength(1);
    const node = layer.container.children[0] as Sprite;
    const p = tileToScreen(4, 2);
    // The authored offset plus the step that keeps the stand clear of the door badges sharing this post.
    expect(node.position.x).toBe(p.x + 17 + CONSTRUCTION_SIGN_DX);
    expect(node.position.y).toBe(p.y + 70);
    layer.draw([]);
    expect(layer.container.children).toHaveLength(0);
  });

  it('draws no construction sign without decoded art (the plot overlay already marks the site)', () => {
    const layer = new ConstructionSignLayer();
    layer.draw([{ id: 9, x: 4 * ONE, y: 2 * ONE }]);
    expect(layer.container.children).toHaveLength(0);
  });
});
