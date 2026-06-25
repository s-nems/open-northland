import { Application, Container, Graphics, Rectangle, Sprite, Texture, type TextureSource } from 'pixi.js';
import { TILE_HALF_H, TILE_HALF_W } from './index.js';
import type { DrawItem, DrawKind } from './scene.js';
import { type SpriteAtlas, type SpriteBindings, resolveSpriteFrame } from './sprites.js';

/**
 * The GPU half of the render line — the part an agent CANNOT self-verify (pixels need a human eye).
 *
 * It is a *pure consumer of the {@link DrawItem} draw list* that the self-verifiable
 * {@link buildScene} layer produces: it walks the already-depth-sorted list in array order and emits
 * one Pixi display object per item, so the GPU never re-derives projection or ordering — those stay
 * unit-tested upstream. The only thing untested here is whether the resulting pixels *look* right;
 * that is exactly what the screenshot harness puts in front of a human (see docs/TESTING.md).
 *
 * **Atlas sprites are wired but optional.** When `renderScene` is handed a {@link SpriteSheet} (the
 * atlas texture source + its {@link SpriteAtlas} frame geometry + the per-kind {@link SpriteBindings}),
 * a drawable item whose kind resolves to an atlas frame ({@link resolveSpriteFrame}, the pure
 * self-verifiable lookup) is drawn as a textured sub-rect of the atlas; everything else still falls
 * back to flat placeholder geometry. Without a sheet — the default, since real bob atlases are decoded
 * from a copyrighted game copy and gitignored (see CLAUDE.md "Legal guardrails") — every item draws as
 * placeholder geometry: an isometric diamond per terrain tile (tinted by landscape typeId), and a
 * feet-anchored marker per sprite (a footprint diamond + a body box, coloured by kind). That is enough
 * to eyeball the load-bearing visual property — *iso projection + depth-sort* (terrain behind sprites,
 * sprites occluding back-to-front by feet) — which is what the harness exists to check. Binding the
 * frame rect to a texture and sampling its pixels is the un-self-verifiable half (a human judges the
 * pixels); the *which frame* decision is the self-verifiable half, unit-tested in `sprites.ts`.
 *
 * Floats everywhere are fine: this is `render`, never read back into the deterministic sim.
 */

/** A flat colour per landscape typeId for the placeholder tiles (cycled if a typeId exceeds the table). */
const TILE_COLOURS: readonly number[] = [
  0x4a7c3a, // 0: grass
  0x3a6ea5, // 1: water
  0x8a6d3b, // 2: dirt/path
  0x9a9a9a, // 3: stone
];

/** Placeholder body colour per drawable sprite kind. */
const KIND_COLOURS: Record<Exclude<DrawKind, 'tile'>, number> = {
  building: 0xc8a04a,
  settler: 0xe8e0d0,
  resource: 0x2f7d32,
};

/** A camera transform applied to every projected screen position before drawing. */
export interface Camera {
  /** Pixel offset added to every item's screen position (pan). */
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * A loaded bob atlas ready for the GPU: the atlas image as a Pixi {@link TextureSource} plus the pure
 * {@link SpriteAtlas} frame geometry and per-kind {@link SpriteBindings} the frame lookup needs. Optional
 * input to {@link renderScene}: when present, bound sprite kinds draw their atlas frame; when absent (or
 * a kind/frame doesn't resolve) the placeholder geometry draws instead. The atlas *image* comes from a
 * free / synthetic atlas (real bobs are gitignored); the frame *geometry* + *bindings* are plain data.
 */
export interface SpriteSheet {
  readonly source: TextureSource;
  readonly atlas: SpriteAtlas;
  readonly bindings: SpriteBindings;
}

/**
 * Initialise a Pixi {@link Application} bound to an existing canvas. Separated from drawing so the
 * (async) GPU init runs once; `renderScene` is then a cheap synchronous redraw. WebGL preference +
 * antialias-off are deliberate: they cut the cross-machine pixel variance that would otherwise make
 * even an eyeball-the-PNG comparison noisy (golden-image diffs stay out of scope — see docs/TESTING.md).
 */
export async function createPixiApp(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): Promise<Application> {
  const app = new Application();
  await app.init({
    canvas,
    width,
    height,
    background: 0x1a1410,
    antialias: false,
    preference: 'webgl',
    autoDensity: false,
    resolution: 1,
  });
  return app;
}

/**
 * Draw one frame from a depth-sorted {@link DrawItem} list. Clears the stage and re-emits every item
 * in array order (the list is already back-to-front, so painter's order == the correct occlusion),
 * then renders once. Pure with respect to the sim: it only reads the draw list + camera (+ an optional
 * atlas {@link SpriteSheet}).
 *
 * When a `sheet` is given, a drawable item whose kind binds to an atlas frame draws as a textured
 * sub-rect of the atlas (feet-anchored); tiles and unbound/empty frames still draw as placeholder
 * geometry. Without a `sheet` every item is placeholder geometry (the reproducible default).
 */
export function renderScene(
  app: Application,
  scene: readonly DrawItem[],
  camera: Camera,
  sheet?: SpriteSheet,
): void {
  app.stage.removeChildren();
  const layer = new Container();
  for (const item of scene) {
    const sx = item.x + camera.offsetX;
    const sy = item.y + camera.offsetY;
    layer.addChild(drawItem(item, sx, sy, sheet));
  }
  app.stage.addChild(layer);
  app.render();
}

/**
 * Pick the display object for one draw item: a textured atlas sprite when a sheet is given and the
 * item's kind resolves to a non-empty frame, otherwise the placeholder geometry (tile diamond or
 * sprite marker). The frame *selection* is the pure {@link resolveSpriteFrame} lookup; binding the
 * rect to the texture is the GPU half.
 */
function drawItem(item: DrawItem, sx: number, sy: number, sheet?: SpriteSheet): Container {
  if (item.kind === 'tile') return tileGraphic(item, sx, sy);
  if (sheet !== undefined) {
    const frame = resolveSpriteFrame(item, sheet.bindings, sheet.atlas);
    if (frame !== null) return atlasSprite(frame, sheet.source, sx, sy);
  }
  return spriteGraphic(item, sx, sy);
}

/**
 * A feet-anchored atlas sprite: a sub-texture of the atlas `source` cut to the frame's pixel rect,
 * placed so the frame's authored draw offset lands at the feet anchor `(sx, sy)`. `offsetX/Y` is the
 * bob's source-area origin (the original's `SBobData.Area`), so adding it to the anchor reproduces
 * where the engine drew the frame relative to the entity's feet.
 */
function atlasSprite(
  frame: { x: number; y: number; width: number; height: number; offsetX: number; offsetY: number },
  source: TextureSource,
  sx: number,
  sy: number,
): Sprite {
  const texture = new Texture({
    source,
    frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
  });
  const sprite = new Sprite(texture);
  sprite.position.set(sx + frame.offsetX, sy + frame.offsetY);
  return sprite;
}

const DEFAULT_TILE_COLOUR = 0x4a7c3a;

/** An isometric ground diamond centred on the tile's projected position, tinted by landscape typeId. */
function tileGraphic(item: DrawItem, sx: number, sy: number): Graphics {
  // `?? DEFAULT_TILE_COLOUR` keeps the value a definite `number` under noUncheckedIndexedAccess.
  const colour = TILE_COLOURS[(item.typeId ?? 0) % TILE_COLOURS.length] ?? DEFAULT_TILE_COLOUR;
  const g = new Graphics();
  g.moveTo(sx, sy - TILE_HALF_H)
    .lineTo(sx + TILE_HALF_W, sy)
    .lineTo(sx, sy + TILE_HALF_H)
    .lineTo(sx - TILE_HALF_W, sy)
    .closePath()
    .fill({ color: colour })
    .stroke({ color: 0x000000, width: 1, alpha: 0.25 });
  return g;
}

/**
 * A feet-anchored sprite placeholder: a small footprint diamond on the ground at the anchor, and a
 * body box rising from it, so depth-sort (who occludes whom) is visible. `(sx, sy)` is the feet
 * anchor; the body is drawn *above* it (negative screen-y) like a real sprite hangs off its feet.
 */
function spriteGraphic(item: DrawItem, sx: number, sy: number): Graphics {
  const colour = KIND_COLOURS[item.kind as Exclude<DrawKind, 'tile'>];
  const bodyW = item.kind === 'building' ? 28 : 14;
  const bodyH = item.kind === 'building' ? 40 : 24;
  const g = new Graphics();
  // Footprint diamond (small) marks the exact feet anchor on the ground.
  g.moveTo(sx, sy - 5)
    .lineTo(sx + 9, sy)
    .lineTo(sx, sy + 5)
    .lineTo(sx - 9, sy)
    .closePath()
    .fill({ color: 0x000000, alpha: 0.3 });
  // Body box rising from the feet.
  g.rect(sx - bodyW / 2, sy - bodyH, bodyW, bodyH)
    .fill({ color: colour })
    .stroke({ color: 0x000000, width: 1, alpha: 0.5 });
  return g;
}
