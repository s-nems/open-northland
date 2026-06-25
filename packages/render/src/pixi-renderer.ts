import { Application, Container, Graphics } from 'pixi.js';
import { TILE_HALF_H, TILE_HALF_W } from './index.js';
import type { DrawItem, DrawKind } from './scene.js';

/**
 * The GPU half of the render line — the part an agent CANNOT self-verify (pixels need a human eye).
 *
 * It is a *pure consumer of the {@link DrawItem} draw list* that the self-verifiable
 * {@link buildScene} layer produces: it walks the already-depth-sorted list in array order and emits
 * one Pixi display object per item, so the GPU never re-derives projection or ordering — those stay
 * unit-tested upstream. The only thing untested here is whether the resulting pixels *look* right;
 * that is exactly what the screenshot harness puts in front of a human (see docs/TESTING.md).
 *
 * **No atlas sprites yet — on purpose.** Real bob atlases are decoded from a copyrighted game copy
 * and are gitignored (see CLAUDE.md "Legal guardrails"), so this slice draws each item as flat
 * placeholder geometry: an isometric diamond per terrain tile (tinted by landscape typeId), and a
 * feet-anchored marker per sprite (a footprint diamond + a body box, coloured by kind). That is
 * enough to eyeball the load-bearing visual property — *iso projection + depth-sort* (terrain behind
 * sprites, sprites occluding back-to-front by feet) — which is what the harness exists to check.
 * Swapping the placeholder for an atlas sprite is a later step once a free/synthetic atlas exists.
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
 * then renders once. Pure with respect to the sim: it only reads the draw list + camera.
 */
export function renderScene(app: Application, scene: readonly DrawItem[], camera: Camera): void {
  app.stage.removeChildren();
  const layer = new Container();
  for (const item of scene) {
    const sx = item.x + camera.offsetX;
    const sy = item.y + camera.offsetY;
    layer.addChild(item.kind === 'tile' ? tileGraphic(item, sx, sy) : spriteGraphic(item, sx, sy));
  }
  app.stage.addChild(layer);
  app.render();
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
