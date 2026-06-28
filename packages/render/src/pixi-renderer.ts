import {
  Application,
  Assets,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  type TextureSource,
} from 'pixi.js';
import type { HudPlacement } from './hud.js';
import { TILE_HALF_H, TILE_HALF_W } from './index.js';
import type { DrawItem, DrawKind } from './scene.js';
import { type AtlasFrame, type SpriteAtlas, type SpriteBindings, resolveSpriteBobId } from './sprites.js';

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
  /**
   * Uniform zoom factor (1 = no scale). Magnifies the whole scene about the layer origin, so a small
   * pixel-art bob is large enough for a human to judge decode fidelity. Applied as the draw layer's
   * scale, with {@link offsetX}/{@link offsetY} as the layer position — so `screen = world*scale +
   * offset`. Defaults to 1.
   */
  readonly scale?: number;
}

/**
 * One drawable atlas layer: a GPU {@link TextureSource} paired with its {@link SpriteAtlas} frame
 * geometry. Overlay layers ({@link SpriteSheet.overlays}) share the body's resolved bob id, so a
 * settler's head bob (same id, a separate `cr_hum_head` atlas) draws on top of the body bob — the
 * original composes a human from layered body + head bob sets, not one sprite.
 */
export interface SpriteLayer {
  readonly source: TextureSource;
  readonly atlas: SpriteAtlas;
}

/**
 * A loaded bob atlas ready for the GPU: the atlas image as a Pixi {@link TextureSource} plus the pure
 * {@link SpriteAtlas} frame geometry and per-kind {@link SpriteBindings} the frame lookup needs. Optional
 * input to {@link renderScene}: when present, bound sprite kinds draw their atlas frame; when absent (or
 * a kind/frame doesn't resolve) the placeholder geometry draws instead. The atlas *image* comes from a
 * free / synthetic atlas (real bobs are gitignored); the frame *geometry* + *bindings* are plain data.
 *
 * `overlays` are extra layers drawn on top of the body in order, each indexed by the **same** resolved
 * bob id (the head bob shares the body's frame numbering) — this is how a layered body + head settler
 * is composed. A layer that lacks the id (or has a 0×0 frame there) is simply skipped for that bob.
 */
export interface SpriteSheet {
  readonly source: TextureSource;
  readonly atlas: SpriteAtlas;
  readonly bindings: SpriteBindings;
  readonly overlays?: readonly SpriteLayer[];
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
  tick = 0,
): void {
  app.stage.removeChildren();
  const layer = new Container();
  // Children are placed at their raw projected world position; the camera (pan + zoom) is the layer's
  // own transform, so `screen = world*scale + offset`. (At scale 1 this is identical to adding the
  // offset per item — the previous behaviour — so existing un-zoomed shots are unchanged.)
  for (const item of scene) {
    layer.addChild(drawItem(item, item.x, item.y, tick, sheet));
  }
  layer.scale.set(camera.scale ?? 1);
  layer.position.set(camera.offsetX, camera.offsetY);
  app.stage.addChild(layer);
  app.render();
}

/**
 * Pick the display object for one draw item: a textured atlas sprite (body + any overlay layers) when a
 * sheet is given and the item's kind resolves to a non-empty frame, otherwise the placeholder geometry
 * (tile diamond or sprite marker). The bob-id *selection* is the pure {@link resolveSpriteBobId} lookup
 * (directional + animated by `tick`); binding the rect to the texture is the GPU half.
 */
function drawItem(item: DrawItem, sx: number, sy: number, tick: number, sheet?: SpriteSheet): Container {
  if (item.kind === 'tile') return tileGraphic(item, sx, sy);
  if (sheet !== undefined) {
    const layered = atlasLayers(item, sx, sy, tick, sheet);
    if (layered !== null) return layered;
  }
  return spriteGraphic(item, sx, sy);
}

/**
 * Compose the layered atlas sprite for a draw item: resolve its bob id once ({@link resolveSpriteBobId},
 * the animated/directional frame decision) then blit that id's frame from the body atlas and every
 * overlay layer (head) on top, in order, into one feet-anchored {@link Container}. Returns `null` when
 * the item is unbound or no layer has a non-empty frame for the id, so the caller falls back to
 * placeholder geometry — preserving the "unbound → placeholder" contract per layer.
 */
function atlasLayers(
  item: DrawItem,
  sx: number,
  sy: number,
  tick: number,
  sheet: SpriteSheet,
): Container | null {
  const bobId = resolveSpriteBobId(item, sheet.bindings, tick);
  if (bobId === null) return null;
  const container = new Container();
  const addLayer = (layer: SpriteLayer): void => {
    const frame = layer.atlas.frames.get(bobId);
    if (frame !== undefined && frame.width > 0 && frame.height > 0) {
      container.addChild(atlasSprite(frame, layer.source, sx, sy));
    }
  };
  addLayer({ source: sheet.source, atlas: sheet.atlas });
  for (const overlay of sheet.overlays ?? []) addLayer(overlay);
  return container.children.length > 0 ? container : null;
}

/**
 * A feet-anchored atlas sprite: a sub-texture of the atlas `source` cut to the frame's pixel rect,
 * placed so the frame's authored draw offset lands at the feet anchor `(sx, sy)`. `offsetX/Y` is the
 * bob's source-area origin (the original's `SBobData.Area`), so adding it to the anchor reproduces
 * where the engine drew the frame relative to the entity's feet.
 */
function atlasSprite(frame: AtlasFrame, source: TextureSource, sx: number, sy: number): Sprite {
  const texture = new Texture({
    source,
    frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
  });
  const sprite = new Sprite(texture);
  sprite.position.set(sx + frame.offsetX, sy + frame.offsetY);
  return sprite;
}

/**
 * Load a decoded atlas PNG (a `<name>.png` the `.bmd`→atlas build emits) as a Pixi {@link TextureSource}
 * ready to bind as a {@link SpriteSheet.source}. The GPU/pixel twin of the pure
 * {@link import('./sprites.js').atlasFromManifest} — together they turn a decoded `<name>.{png,atlas.json}`
 * pair into a {@link SpriteSheet}. `nearest` scaling keeps the pixel-art bobs crisp and cuts the
 * cross-machine sampling variance (matching {@link createPixiApp}'s antialias-off), so an eyeball-the-PNG
 * check stays meaningful. Real bob atlases are decoded from a copyrighted game copy and gitignored (see
 * CLAUDE.md "Legal guardrails"); this only takes a URL, so the *bytes* never live in the repo — the app
 * serves them from the gitignored `content/` over the dev/shot server, exactly as `?map=` serves grids.
 */
export async function loadAtlasSource(url: string): Promise<TextureSource> {
  const texture = (await Assets.load(url)) as Texture;
  texture.source.scaleMode = 'nearest';
  return texture.source;
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

/**
 * Visual style for the HUD panel — the part a human tunes (colour/font/opacity), kept here so the
 * pure {@link HudPlacement} carries only geometry. `panelColor`/`panelAlpha` paint the backing rect;
 * `textColor`/`fontSize`/`fontFamily` style every text row.
 */
export interface HudStyle {
  readonly panelColor: number;
  readonly panelAlpha: number;
  readonly textColor: number;
  readonly fontSize: number;
  readonly fontFamily: string;
}

/** A readable default HUD style (a dark translucent panel, light monospace text). */
export const DEFAULT_HUD_STYLE: HudStyle = {
  panelColor: 0x000000,
  panelAlpha: 0.55,
  textColor: 0xf0e8d8,
  fontSize: 12,
  fontFamily: 'monospace',
};

/**
 * Draw a placed HUD panel onto the Pixi stage — the GPU half of the HUD line, the un-self-verifiable
 * twin of {@link renderScene} for the on-screen panel. It is a *pure consumer of a {@link HudPlacement}*
 * (`placeHud`'s output): a backing rectangle at the panel box plus one Pixi {@link Text} per already
 * screen-positioned row, in row order — the GPU re-derives no layout, exactly as `renderScene` re-derives
 * no projection. The *which string lands where* decision stays unit-tested upstream (`layoutHud`/
 * `placeHud`); the only thing untested here is whether the glyphs *look* right — a human eyeballs that
 * (the screenshot harness, docs/TESTING.md).
 *
 * It adds its display objects to the existing stage (a HUD overlay sits on TOP of the world scene), so
 * call it AFTER {@link renderScene} for one frame — `renderScene` clears the stage, then this overlays.
 * Floats are fine; this is `render`, never read back into the deterministic sim.
 */
export function renderHud(
  app: Application,
  placement: HudPlacement,
  style: HudStyle = DEFAULT_HUD_STYLE,
): void {
  const layer = new Container();

  // Backing panel rect (the box the layout sized) — drawn first so the text overlays it.
  const panel = new Graphics();
  panel
    .rect(placement.panelX, placement.panelY, placement.width, placement.height)
    .fill({ color: style.panelColor, alpha: style.panelAlpha });
  layer.addChild(panel);

  // One text object per row, at its absolute screen position. The placement already ordered the rows
  // top-to-bottom and indented the tallies, so the GPU just paints each string where it was placed.
  for (const row of placement.rows) {
    const text = new Text({
      text: row.text,
      style: { fill: style.textColor, fontSize: style.fontSize, fontFamily: style.fontFamily },
    });
    text.position.set(row.x, row.y);
    layer.addChild(text);
  }

  app.stage.addChild(layer);
  app.render();
}
